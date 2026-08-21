/**
 * Shared contract for "Analyse barcode with AI" — used by BOTH the Vercel
 * function (api/teach-label.ts) and the client flow, so the two can't drift.
 *
 * === SAFETY RULE (same as label teaching, stricter consequences) ===
 * The AI returns a FORMAT MAP: which digit POSITIONS carry which fields. It
 * never returns a value that gets counted. The scanned digit string is sent
 * to the model as text (exact, from the scanner) purely so it can work out
 * the structure by cross-referencing against the printed label in the photo.
 * All later decoding happens on-device from the scanner's own digits.
 */

// NB: the .js extension is REQUIRED. This module is loaded by the Vercel
// serverless function, the project is ESM ("type": "module"), and the Node
// ESM resolver does not add extensions — an extensionless relative import
// here kills the whole function at cold start (FUNCTION_INVOCATION_FAILED →
// HTTP 500 for BOTH teach modes, not just this one).
import { TEACH_MAX_IMAGE_BASE64, TEACH_MEDIA_TYPES, type TeachMediaType } from './teachShared.js';

/** Longest barcode string we'll analyse (well past any real carton code). */
export const BARCODE_MAX_DIGITS = 64;

export interface BarcodeTeachRequestBody {
  mode: 'barcode';
  image: string; // base64, no data: prefix
  mediaType: TeachMediaType;
  /** The EXACT string the scanner read — never re-typed, never AI-read. */
  digits: string;
}

/** Validate a POSTed barcode-analysis body. Returns an error, or null. */
export function validateBarcodeTeachRequest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (typeof b.image !== 'string' || b.image.length === 0) return 'Missing image';
  if (b.image.length > TEACH_MAX_IMAGE_BASE64) return 'Image too large — retake at a lower resolution';
  if (!/^[A-Za-z0-9+/=]+$/.test(b.image.slice(0, 1000))) return 'Image must be base64 (no data: prefix)';
  if (!TEACH_MEDIA_TYPES.includes(b.mediaType as TeachMediaType)) return 'Unsupported image type';
  if (typeof b.digits !== 'string' || b.digits.length === 0) return 'Missing scanned barcode string';
  if (b.digits.length > BARCODE_MAX_DIGITS) return 'Barcode string too long';
  if (!/^[A-Za-z0-9]+$/.test(b.digits)) return 'Barcode string must be alphanumeric';
  return null;
}

/** The analysis prompt. `digits` is the exact scanned string. */
export function barcodePrompt(digits: string): string {
  return `A warehouse scanner read this EXACT barcode string from a meat carton:

${digits}

(length: ${digits.length} characters)

The photo is the SAME carton's label. This barcode is not GS1, so the app cannot decode it. Your job is to work out the FORMAT MAP: which character POSITIONS in that string encode which fields.

METHOD — derive the map by CROSS-CHECKING, not by guessing:
1. Read the values PRINTED on the label in the photo (net weight, dates, product code, serial/carton number).
2. Find those values inside the scanned string above.
3. For each field, propose start position (0-indexed) and length, then DECODE that slice yourself and confirm the result reproduces the printed value.
4. If you cannot make a field reproduce its printed value, return null for that field. Do NOT guess.

WEIGHT: give the multiplier that converts the raw digits to the printed value — e.g. digits "153" printed as "15.3 kg" means multiplier 0.1 and unit "kg". Use the NET weight, never gross/tare. Set weightMatchesPrinted true only if digits × multiplier equals the printed net weight.

DATES: identify the encoding — "yy-dayofyear" (e.g. 24068 = day 68 of 2024 = 8 March 2024), "yymmdd", "ddmmyy", "yyyymmdd", or "other" if none fit. Prefer the PRODUCTION/packing date for productionDate. Set dateMatchesPrinted true only if your decoding reproduces the printed date.

SIGNATURE: how a future scan of this format is recognised — its total length, and any fixed leading characters that identify it (prefix, and how many characters that prefix is). If there is no reliable fixed prefix, use null.

Positions are 0-indexed into the string EXACTLY as given, counting every character.

Return ONLY valid JSON matching the required schema — no prose, no markdown fences. Use null for anything not determinable.`;
}

/**
 * JSON schema enforced via output_config.format.
 *
 * IMPORTANT: the structured-output schema subset does NOT support numeric
 * constraints — `minimum` / `maximum` / `exclusiveMinimum` on a number or
 * integer are rejected with a 400 ("For 'integer' type, property 'minimum'
 * is not supported"), which took this whole mode down in the field. Bounds
 * are enforced in code instead: coerceBarcodeMap rejects nonsense, and
 * validateProposedMap re-decodes the real scanned string. Keep this schema to
 * type / enum / anyOf / required / additionalProperties — schemaKeywords.test
 * fails the build if an unsupported keyword creeps back in.
 */
const confidence = { type: 'number' };
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const baseField = {
  start: { type: 'integer' },
  length: { type: 'integer' },
  printedValueSeen: nullableString,
  confidence,
};

const plainField = {
  anyOf: [
    {
      type: 'object',
      properties: { ...baseField },
      required: ['start', 'length', 'printedValueSeen', 'confidence'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
};

const dateField = {
  anyOf: [
    {
      type: 'object',
      properties: {
        ...baseField,
        encoding: {
          type: 'string',
          enum: ['yy-dayofyear', 'yymmdd', 'ddmmyy', 'yyyymmdd', 'other'],
        },
      },
      required: ['start', 'length', 'encoding', 'printedValueSeen', 'confidence'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
};

export const BARCODE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    formatName: { type: 'string' },
    totalLength: { type: 'integer' },
    fields: {
      type: 'object',
      properties: {
        netWeight: {
          anyOf: [
            {
              type: 'object',
              properties: {
                ...baseField,
                encoding: { type: 'string', enum: ['integer', 'decimal-implied'] },
                multiplier: { type: 'number' },
                unit: { type: 'string', enum: ['kg', 'lb'] },
              },
              required: ['start', 'length', 'encoding', 'multiplier', 'unit', 'printedValueSeen', 'confidence'],
              additionalProperties: false,
            },
            { type: 'null' },
          ],
        },
        productionDate: dateField,
        productCode: plainField,
        serial: plainField,
        bestBefore: dateField,
      },
      required: ['netWeight', 'productionDate', 'productCode', 'serial', 'bestBefore'],
      additionalProperties: false,
    },
    signature: {
      type: 'object',
      properties: {
        length: { type: 'integer' },
        prefix: nullableString,
        prefixLength: { type: 'integer' },
      },
      required: ['length', 'prefix', 'prefixLength'],
      additionalProperties: false,
    },
    verification: {
      type: 'object',
      properties: {
        weightMatchesPrinted: { type: 'boolean' },
        dateMatchesPrinted: { type: 'boolean' },
        notes: nullableString,
      },
      required: ['weightMatchesPrinted', 'dateMatchesPrinted', 'notes'],
      additionalProperties: false,
    },
  },
  required: ['formatName', 'totalLength', 'fields', 'signature', 'verification'],
  additionalProperties: false,
} as const;

/**
 * Pull the map JSON out of the model's text. Structured outputs should make
 * this pure JSON; the fence/brace tolerance is a defence layer.
 */
export function extractBarcodeMapJson(text: string): unknown {
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidate = fence[1].trim();
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON object in AI response');
    candidate = candidate.slice(start, end + 1);
  }
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  if (typeof parsed !== 'object' || parsed === null || !('fields' in parsed) || !('signature' in parsed)) {
    throw new Error('AI response missing expected fields');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// UNSCANNABLE mode — the barcode won't scan at all
// ---------------------------------------------------------------------------

/**
 * When a barcode is damaged, missing, or simply won't read, there is no digit
 * string to derive a format map from. This mode instead reads THIS carton's
 * printed values off the photo, for the human to confirm before anything is
 * counted.
 *
 * Consequences, deliberately: no format map is saved (there are no scanned
 * positions to learn), and the resulting carton is flagged as AI-assisted —
 * never as a scanned value — in the session and the export.
 */
export interface CartonReadRequestBody {
  mode: 'carton';
  image: string;
  mediaType: TeachMediaType;
}

export function validateCartonReadRequest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (typeof b.image !== 'string' || b.image.length === 0) return 'Missing image';
  if (b.image.length > TEACH_MAX_IMAGE_BASE64) return 'Image too large — retake at a lower resolution';
  if (!/^[A-Za-z0-9+/=]+$/.test(b.image.slice(0, 1000))) return 'Image must be base64 (no data: prefix)';
  if (!TEACH_MEDIA_TYPES.includes(b.mediaType as TeachMediaType)) return 'Unsupported image type';
  return null;
}

export const CARTON_READ_PROMPT = `This is a photo of a meat carton label whose barcode cannot be scanned. Read the values PRINTED on this specific carton so a human can check them and record the carton by hand.

Read exactly what is printed — do not infer, round, or calculate:
- netWeightPrinted: the NET weight exactly as printed, including its unit (e.g. "17.54 KG"). Use the NET weight only, never gross or tare. If the label prints both kg and lb, use the kg figure.
- netWeightValue: that same net weight as a number, in the unit you report below.
- unit: "kg" or "lb" — whichever netWeightValue is in.
- productionDate / bestBefore / useBy: each as YYYY-MM-DD if a date is printed, else null. Convert printed forms like "30/JUN/2026" or "06 JUL 26" to YYYY-MM-DD. Assume the 2000s for two-digit years.
- product: the product description as printed.
- productCode: the item/product code printed on the label, if any.
- batch: the batch/lot number if printed.
- serial: a per-carton serial or carton number if printed.
- confidence: 0-1, how confident you are in netWeightValue specifically.
- notes: anything that makes the weight hard to read (glare, creasing, partly obscured), or null.

If the net weight is not legible, set netWeightValue and netWeightPrinted to null rather than guessing — a wrong weight is far worse than no weight.

Return ONLY valid JSON matching the required schema — no prose, no markdown fences.`;

export const CARTON_READ_SCHEMA = {
  type: 'object',
  properties: {
    netWeightPrinted: nullableString,
    netWeightValue: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    unit: { anyOf: [{ type: 'string', enum: ['kg', 'lb'] }, { type: 'null' }] },
    productionDate: nullableString,
    bestBefore: nullableString,
    useBy: nullableString,
    product: nullableString,
    productCode: nullableString,
    batch: nullableString,
    serial: nullableString,
    confidence: { type: 'number' },
    notes: nullableString,
  },
  required: [
    'netWeightPrinted', 'netWeightValue', 'unit', 'productionDate', 'bestBefore',
    'useBy', 'product', 'productCode', 'batch', 'serial', 'confidence', 'notes',
  ],
  additionalProperties: false,
} as const;

/** What the AI read off an unscannable carton's label. Values are PROPOSALS. */
export interface CartonRead {
  netWeightPrinted: string | null;
  netWeightValue: number | null;
  unit: 'kg' | 'lb' | null;
  productionDate: string | null;
  bestBefore: string | null;
  useBy: string | null;
  product: string | null;
  productCode: string | null;
  batch: string | null;
  serial: string | null;
  confidence: number;
  notes: string | null;
}

export function extractCartonReadJson(text: string): CartonRead {
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidate = fence[1].trim();
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON object in AI response');
    candidate = candidate.slice(start, end + 1);
  }
  const parsed = JSON.parse(candidate) as CartonRead;
  if (typeof parsed !== 'object' || parsed === null || !('netWeightValue' in parsed)) {
    throw new Error('AI response missing expected fields');
  }
  return parsed;
}
