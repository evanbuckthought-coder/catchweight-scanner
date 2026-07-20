/**
 * Shared contract for the "Teach a new label" AI call — used by BOTH the
 * Vercel serverless function (api/teach-label.ts) and the client teach flow.
 * Keeping the schema/prompt/parsing in one module means the two sides can
 * never drift, and the pure functions are unit-testable without a server.
 *
 * Safety rule 8 (non-negotiable): the AI teaches LAYOUT/FORMAT only. The
 * printed weight value is returned solely so the human can verify the read
 * against the photo on the confirm screen — it is NEVER saved to a profile
 * and NEVER reused as a weight.
 */

export type TeachConfidence = 'high' | 'medium' | 'low';

export interface TeachField {
  value: string | null;
  confidence: TeachConfidence;
}

export interface TeachGtin {
  value: string | null;
  /**
   * gs1-128-weight: GS1-128 whose AIs include a net weight (310n/320n) —
   * barcode scanning alone captures the weight. gs1-128: GS1-128 without a
   * weight AI. plain: non-GS1 carton ID (EAN/Code128/etc). none: no barcode.
   */
  barcodeType: 'gs1-128-weight' | 'gs1-128' | 'plain' | 'none' | 'unknown';
  confidence: TeachConfidence;
}

export interface TeachWeight {
  /** The weight exactly as printed (e.g. "21.652 kg") — display-only, never stored. */
  printedExample: string | null;
  unit: 'kg' | 'lb' | null;
  /** Decimal places in the printed net weight (e.g. 21.652 -> 3). */
  decimalPlaces: number | null;
  /** Where on the label the NET weight is printed (e.g. "bottom-right, below the barcode"). */
  region: string | null;
  /** Literal text printed next to the weight (e.g. "NET WEIGHT", "Net kg"). */
  anchorText: string | null;
  /**
   * Nominal carton/pack SIZE stated on the label (the "10" in "FS FDSERV
   * WINGS 10KG"), in kg — null when the label states no pack size. Distinct
   * from the actual printed net weight: on a set-weight carton the barcode
   * carries no weight, so this is the per-carton figure a count uses.
   */
  nominalPackKg: number | null;
  confidence: TeachConfidence;
}

export interface TeachDate {
  kind: 'production' | 'packaging' | 'best-before' | 'use-by' | 'unknown';
  /** Printed format, e.g. "DD/MM/YYYY", "DD MMM YYYY", "YYMMDD". */
  printedFormat: string;
  /** Literal label text next to the date (e.g. "PKD", "BEST BEFORE"), if any. */
  label: string | null;
  confidence: TeachConfidence;
}

export interface TeachResult {
  supplier: TeachField;
  /** Manufacturer if printed separately from the supplier/brand, else null. */
  manufacturer: TeachField;
  product: TeachField;
  gtin: TeachGtin;
  weight: TeachWeight;
  dates: TeachDate[];
  batch: TeachField;
  serial: TeachField;
  /** Anything else useful about the layout (free text), or null. */
  notes: string | null;
}

/** Media types the endpoint accepts (client always sends JPEG after downscale). */
export const TEACH_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TeachMediaType = (typeof TEACH_MEDIA_TYPES)[number];

/**
 * Upper bound on the base64 image payload (~3 MB binary). The client
 * downscales to ≤1600 px JPEG (~200–500 KB) so a legitimate request never
 * gets near this; it exists to reject abuse before an AI call is made.
 */
export const TEACH_MAX_IMAGE_BASE64 = 4_000_000;

/** Max free-text hint length. */
export const TEACH_MAX_HINT = 500;

/** Header the app sends; the function compares it to the TEACH_SHARED_SECRET env var. */
export const TEACH_SECRET_HEADER = 'x-teach-secret';

export interface TeachRequestBody {
  image: string; // base64 (no data: prefix)
  mediaType: TeachMediaType;
  hint?: string;
}

/** Validate a POSTed body. Returns an error message, or null when valid. */
export function validateTeachRequest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (typeof b.image !== 'string' || b.image.length === 0) return 'Missing image';
  if (b.image.length > TEACH_MAX_IMAGE_BASE64) return 'Image too large — retake at a lower resolution';
  if (!/^[A-Za-z0-9+/=]+$/.test(b.image.slice(0, 1000))) return 'Image must be base64 (no data: prefix)';
  if (!TEACH_MEDIA_TYPES.includes(b.mediaType as TeachMediaType)) return 'Unsupported image type';
  if (b.hint !== undefined && (typeof b.hint !== 'string' || b.hint.length > TEACH_MAX_HINT))
    return 'Hint too long';
  return null;
}

// ---------------------------------------------------------------------------
// Vision prompt + structured-output schema
// ---------------------------------------------------------------------------

export const TEACH_PROMPT = `You are analysing a photo of a meat/food carton label so a warehouse app can learn this supplier's label LAYOUT. The app captures each carton's actual weight fresh at receiving time (catchweight) — your job is only to describe WHERE things are and HOW they are formatted on this label design.

Identify, where present (use null when absent, never guess values):
- supplier: the supplier/brand name as printed
- manufacturer: the manufacturing company if printed separately from the supplier/brand (else null)
- product: the product description as printed
- gtin: the barcode number (GTIN/EAN) if printed as human-readable digits, and classify the barcode: "gs1-128-weight" if it is a GS1-128 whose human-readable line shows AIs including a net weight (310n or 320n), "gs1-128" if GS1-128 without a weight AI, "plain" for a simple product/carton barcode, "none" if no barcode is visible, "unknown" if unclear
- weight: the NET weight — its printed example exactly as shown, the unit (kg or lb), how many decimal places, WHERE on the label it sits (short region description, e.g. "bottom-right, inside the boxed grid"), and the literal anchor text printed beside it (e.g. "NET WEIGHT", "Net kg"). Ignore GROSS/TARE weights. Also give nominalPackKg: the nominal carton/pack SIZE stated on the label in kg — the "10" in a product description like "FS FDSERV WINGS 10KG", or the "12" in "CHICKEN TENDERLOINS 12KG AP" — or null if the label states no pack size. This is the fixed per-carton size, which is NOT the same as the actual printed net weight.
- dates: every date on the label — classify each as production / packaging / best-before / use-by / unknown, give the printed FORMAT (e.g. "DD/MM/YYYY", "DD MMM YYYY", "YYMMDD") not the actual date, and the label text beside it
- batch: the batch/lot number if printed (the value as printed, so the human can verify)
- serial: a per-carton serial number if printed
- notes: one short sentence of anything else layout-relevant, or null

Set a confidence (high/medium/low) on each field. Return only the structured result.`;

/** JSON schema enforced via output_config.format — guarantees parseable output. */
const confidence = { type: 'string', enum: ['high', 'medium', 'low'] };
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const teachField = {
  type: 'object',
  properties: { value: nullableString, confidence },
  required: ['value', 'confidence'],
  additionalProperties: false,
};

export const TEACH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    supplier: teachField,
    manufacturer: teachField,
    product: teachField,
    gtin: {
      type: 'object',
      properties: {
        value: nullableString,
        barcodeType: {
          type: 'string',
          enum: ['gs1-128-weight', 'gs1-128', 'plain', 'none', 'unknown'],
        },
        confidence,
      },
      required: ['value', 'barcodeType', 'confidence'],
      additionalProperties: false,
    },
    weight: {
      type: 'object',
      properties: {
        printedExample: nullableString,
        unit: { anyOf: [{ type: 'string', enum: ['kg', 'lb'] }, { type: 'null' }] },
        decimalPlaces: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        region: nullableString,
        anchorText: nullableString,
        nominalPackKg: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        confidence,
      },
      required: ['printedExample', 'unit', 'decimalPlaces', 'region', 'anchorText', 'nominalPackKg', 'confidence'],
      additionalProperties: false,
    },
    dates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['production', 'packaging', 'best-before', 'use-by', 'unknown'],
          },
          printedFormat: { type: 'string' },
          label: nullableString,
          confidence,
        },
        required: ['kind', 'printedFormat', 'label', 'confidence'],
        additionalProperties: false,
      },
    },
    batch: teachField,
    serial: teachField,
    notes: nullableString,
  },
  required: ['supplier', 'manufacturer', 'product', 'gtin', 'weight', 'dates', 'batch', 'serial', 'notes'],
  additionalProperties: false,
} as const;

/**
 * Parse the model's text into a TeachResult. Structured outputs should make
 * the text pure JSON, but stay tolerant of markdown fences / surrounding
 * prose as a defence layer. Throws on anything unusable.
 */
export function extractTeachJson(text: string): TeachResult {
  let candidate = text.trim();
  // Strip a ```json ... ``` fence if present.
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidate = fence[1].trim();
  // Fall back to the outermost braces if prose surrounds the JSON.
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON object in AI response');
    candidate = candidate.slice(start, end + 1);
  }
  const parsed = JSON.parse(candidate) as TeachResult;
  if (typeof parsed !== 'object' || parsed === null || !('weight' in parsed) || !('supplier' in parsed)) {
    throw new Error('AI response missing expected fields');
  }
  return parsed;
}
