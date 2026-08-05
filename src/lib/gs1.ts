/**
 * GS1-128 parser for random-weight (catchweight) meat carton labels.
 *
 * A GS1-128 barcode is a concatenation of `(AI)data` element strings. We accept
 * two input shapes:
 *   1. Raw scanner output  -> variable-length fields are terminated by the
 *      FNC1 / GS separator (ASCII 29, "\x1d"). Fixed-length fields are not.
 *   2. Human-readable form -> "(01)0123...(3102)000705(10)ABC" with the AIs in
 *      parentheses. Used for manual paste and the dev "simulated scan" buttons.
 *
 * The parser is deliberately conservative: if a field is missing or an AI is
 * unknown it is surfaced as an error/unknown rather than guessed. Downstream UI
 * decides whether the carton is usable. Every record keeps the original raw
 * string for the audit trail.
 */

import { toKg, type WeightUnit } from './units';

/** FNC1 / Group Separator that terminates variable-length AI fields. */
export const GS = '\x1d';

/** AIs whose data length is fixed (does NOT need a GS terminator). */
const FIXED_LENGTH_AIS: Record<string, number> = {
  '00': 18, // SSCC
  '01': 14, // GTIN
  '11': 6, // Production date  YYMMDD
  '13': 6, // Packaging date   YYMMDD
  '15': 6, // Best before      YYMMDD
  '17': 6, // Use by / expiry  YYMMDD
};

/** AIs whose data is variable length and therefore terminated by GS / end.
 *  ('30' — variable count — is tokenised so it can't derail a label, though
 *  we don't decode it semantically.) */
const VARIABLE_LENGTH_AIS = new Set(['10', '21', '30', '37']);

/** AIs we treat as date fields (YYMMDD -> 20YY-MM-DD). */
const DATE_AIS: Record<string, keyof Pick<ParsedCarton,
  'productionDate' | 'packagingDate' | 'bestBefore' | 'useBy'>> = {
  '11': 'productionDate',
  '13': 'packagingDate',
  '15': 'bestBefore',
  '17': 'useBy',
};

/** A single decoded application identifier element. */
export interface GS1Element {
  ai: string;
  data: string;
}

/** Fully parsed carton record. Most fields are optional — real labels vary. */
export interface ParsedCarton {
  /** Original scanned/pasted string, kept verbatim for audit. */
  raw: string;

  gtin?: string;
  /** Leading 7 GTIN digits — used for the format fingerprint + supplier match. */
  companyPrefix?: string;

  /**
   * Which format produced this record. 'custom' means a non-GS1 barcode
   * decoded on-device by an AI-taught format map (see lib/barcodeMaps.ts) —
   * such labels have no GTIN, so their identity is `itemCode`.
   */
  format?: 'gs1' | 'custom';
  /** Product/item code from a custom-format barcode (no GTIN on the label). */
  itemCode?: string;
  /** Name of the custom format that decoded this, for display. */
  formatName?: string;

  /** NET weight in its labelled unit (kg for 310n, lb for 320n). */
  netWeight?: number;
  weightUnit?: WeightUnit;
  /** Always-normalised NET weight in kilograms. */
  weightKg?: number;
  /** The net-weight AI actually used, e.g. "3102" or "3204". */
  weightAI?: string;

  /** GROSS weight (AI 330n kg / 340n lb) — recorded for reference but NEVER
   *  used as the carton weight; gross includes packaging. */
  grossWeight?: number;
  grossUnit?: WeightUnit;
  grossKg?: number;
  grossAI?: string;

  /** Batch / lot (AI 10). */
  batch?: string;
  /** Serial (AI 21). */
  serial?: string;
  /** Traceability id = batch if present, else serial. */
  traceId?: string;
  /** Which AI supplied the trace id: "10" or "21". */
  traceAI?: string;

  productionDate?: string;
  packagingDate?: string;
  bestBefore?: string;
  useBy?: string;

  /** SSCC (AI 00), optional. */
  sscc?: string;
  /** Count (AI 37), optional. */
  count?: string;

  /**
   * Format fingerprint: which weight AI + which trace AI + company prefix.
   * Lets us notice when a known GTIN suddenly arrives in a different layout.
   */
  fingerprint?: string;

  /** All decoded elements, in order (debugging / completeness). */
  elements: GS1Element[];
  /** AIs we recognised structurally but don't decode semantically. */
  unknownAIs: GS1Element[];
  /** Human-readable problems (missing GTIN, missing weight, bad token, ...). */
  errors: string[];
  /** True when the record has the minimum to be a usable carton. */
  valid: boolean;
}

/** Strip a leading symbology identifier (e.g. "]C1", "]e0") if present. */
function stripSymbologyId(s: string): string {
  // ZBar / hardware scanners sometimes prefix the AIM symbology id.
  return s.replace(/^\][A-Za-z]\d/, '');
}

/** Format a YYMMDD GS1 date as 20YY-MM-DD (or 20YY-MM if day is 00). */
export function formatGS1Date(yymmdd: string): string {
  if (!/^\d{6}$/.test(yymmdd)) return yymmdd; // surface malformed value as-is
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  // Per spec these labels use the 20YY century. (GS1's sliding-window rule is
  // out of scope for this proof-of-loop and noted here deliberately.)
  const year = `20${yy}`;
  return dd === '00' ? `${year}-${mm}` : `${year}-${mm}-${dd}`;
}

/** Tokenise the human-readable "(AI)data" form into elements. */
function tokenizeParenthesised(input: string): { elements: GS1Element[]; errors: string[] } {
  const elements: GS1Element[] = [];
  const errors: string[] = [];
  const re = /\((\d{2,4})\)([^(]*)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index !== lastIndex) {
      errors.push(`Unexpected characters before "(${m[1]})"`);
    }
    // Data may carry stray GS chars from mixed input; strip them here.
    elements.push({ ai: m[1], data: m[2].replace(/\x1d/g, '') });
    lastIndex = re.lastIndex;
  }
  if (elements.length === 0) errors.push('No (AI) elements found');
  return { elements, errors };
}

/**
 * Tokenise raw scanner output using AI lengths + the GS separator.
 *
 * Weight AIs (31xx / 32xx) are 4 digits with 6 fixed data digits. All other
 * AIs we handle are 2 digits. Variable-length fields read until the next GS or
 * end of string; if a label omits the GS (some hardware does), the remainder is
 * consumed and an error is recorded rather than silently mis-splitting.
 */
function tokenizeRaw(input: string): { elements: GS1Element[]; errors: string[] } {
  const elements: GS1Element[] = [];
  const errors: string[] = [];
  let i = 0;
  // A leading FNC1/GS (GS1 mode marker) carries no data — skip it.
  while (input[i] === GS) i++;

  while (i < input.length) {
    const two = input.slice(i, i + 2);
    if (!/^\d{2}$/.test(two)) {
      errors.push(`Expected an AI at position ${i}, found "${input.slice(i, i + 4)}"`);
      break;
    }

    // 31xx–36xx -> the whole GS1 measurement block (net/gross weight, length,
    // area, volume…): 4-digit AI, 6 fixed data digits. Tokenising ALL of them
    // matters even though only weights are decoded — a gross weight or
    // dimension transmitted BEFORE the net weight must not derail the walk.
    if (/^3[1-6]$/.test(two)) {
      const ai = input.slice(i, i + 4);
      if (!/^\d{4}$/.test(ai)) {
        errors.push(`Malformed measurement AI "${input.slice(i, i + 4)}"`);
        break;
      }
      const data = input.slice(i + 4, i + 4 + 6);
      if (data.length < 6) {
        errors.push(`AI ${ai} truncated (need 6 digits, got "${data}")`);
        break;
      }
      elements.push({ ai, data });
      i += 4 + 6;
      continue;
    }

    const ai = two;
    if (ai in FIXED_LENGTH_AIS) {
      const len = FIXED_LENGTH_AIS[ai];
      const data = input.slice(i + 2, i + 2 + len);
      if (data.length < len) {
        errors.push(`AI ${ai} truncated (need ${len} chars, got "${data}")`);
        break;
      }
      elements.push({ ai, data });
      i += 2 + len;
      continue;
    }

    if (VARIABLE_LENGTH_AIS.has(ai)) {
      const rest = input.slice(i + 2);
      const gsAt = rest.indexOf(GS);
      if (gsAt === -1) {
        elements.push({ ai, data: rest });
        i = input.length;
      } else {
        elements.push({ ai, data: rest.slice(0, gsAt) });
        i += 2 + gsAt + 1; // skip the GS terminator
      }
      continue;
    }

    // Unknown AI of unknown length — we cannot safely keep walking.
    errors.push(`Unknown AI "${ai}" — cannot determine field length, stopping`);
    break;
  }

  if (elements.length === 0 && errors.length === 0) errors.push('Empty barcode');
  return { elements, errors };
}

/** Build a ParsedCarton from a flat element list. */
function buildCarton(raw: string, elements: GS1Element[], errors: string[]): ParsedCarton {
  const carton: ParsedCarton = {
    raw,
    elements,
    unknownAIs: [],
    errors: [...errors],
    valid: false,
  };

  // Weight candidates are collected, not applied on sight, so precedence is
  // deterministic regardless of the order AIs appear in the barcode.
  type WeightCandidate = { ai: string; unit: WeightUnit; value: number };
  const netCandidates: WeightCandidate[] = [];
  const grossCandidates: WeightCandidate[] = [];

  for (const el of elements) {
    const { ai, data } = el;

    // Measurement block 31xx–36xx (4-digit AI, last digit = decimal places).
    // Weights: 310n net kg, 320n net lb, 330n GROSS kg, 340n GROSS lb.
    // Everything else in the block (length, area, volume, dimensions) is NOT
    // a carton weight and is deliberately ignored for weight purposes.
    if (/^3[1-6]\d\d$/.test(ai)) {
      const family = ai.slice(0, 3);
      const isNet = family === '310' || family === '320';
      const isGross = family === '330' || family === '340';
      if (isNet || isGross) {
        const n = Number(ai[3]);
        const intVal = /^\d+$/.test(data) ? Number(data) : NaN;
        if (!Number.isFinite(intVal)) {
          carton.errors.push(`Weight AI ${ai} has non-numeric data "${data}"`);
        } else {
          const unit: WeightUnit = family === '310' || family === '330' ? 'kg' : 'lb';
          const candidate = { ai, unit, value: intVal / 10 ** n };
          (isNet ? netCandidates : grossCandidates).push(candidate);
        }
      } else {
        carton.unknownAIs.push(el);
      }
      continue;
    }

    switch (ai) {
      case '01':
        carton.gtin = data;
        carton.companyPrefix = data.slice(0, 7);
        if (!/^\d{14}$/.test(data)) carton.errors.push(`GTIN should be 14 digits, got "${data}"`);
        break;
      case '00':
        carton.sscc = data;
        break;
      case '10':
        carton.batch = data;
        break;
      case '21':
        carton.serial = data;
        break;
      case '37':
        carton.count = data;
        break;
      case '11':
      case '13':
      case '15':
      case '17':
        carton[DATE_AIS[ai]] = formatGS1Date(data);
        break;
      default:
        carton.unknownAIs.push(el);
    }
  }

  // NET weight is the carton weight; a kg AI wins over an lb one on
  // dual-unit labels (kg is what totals are kept in — no conversion noise).
  const net = netCandidates.find((c) => c.unit === 'kg') ?? netCandidates[0];
  if (net) {
    carton.netWeight = net.value;
    carton.weightUnit = net.unit;
    carton.weightKg = toKg(net.value, net.unit);
    carton.weightAI = net.ai;
  }
  // Gross is recorded for reference only — never a substitute for net.
  const gross = grossCandidates.find((c) => c.unit === 'kg') ?? grossCandidates[0];
  if (gross) {
    carton.grossWeight = gross.value;
    carton.grossUnit = gross.unit;
    carton.grossKg = toKg(gross.value, gross.unit);
    carton.grossAI = gross.ai;
  }

  // Traceability id: batch (10) wins over serial (21).
  if (carton.batch) {
    carton.traceId = carton.batch;
    carton.traceAI = '10';
  } else if (carton.serial) {
    carton.traceId = carton.serial;
    carton.traceAI = '21';
  }

  // Format fingerprint for "has this GTIN changed layout?" checks.
  carton.fingerprint = [
    carton.weightAI ?? '?',
    carton.traceAI ?? '?',
    carton.companyPrefix ?? '?',
  ].join('|');

  // Minimum bar for a usable carton: a GTIN and a NET weight.
  if (!carton.gtin) carton.errors.push('No GTIN (AI 01) found');
  if (carton.weightKg === undefined) {
    if (carton.grossAI) {
      // Gross-only labels are flagged, never silently downgraded to net.
      carton.errors.push(
        `Only GROSS weight (AI ${carton.grossAI}) found — no net weight (310n/320n) on this barcode`,
      );
    } else {
      // Diagnostic: name the AIs that WERE present, so an unhandled weight
      // AI shows up in the error instead of being silently missed.
      const present = elements.map((e) => e.ai).join(', ');
      carton.errors.push(
        `No net weight (AI 310n/320n) found${present ? ` — AIs present: ${present}` : ''}`,
      );
    }
  }
  carton.valid = !!carton.gtin && carton.weightKg !== undefined;

  return carton;
}

/**
 * The identity a carton is keyed by: the GTIN on a GS1 label, or the item
 * code on a custom-format one. Use this wherever a scan needs a product key
 * (dedupe, profiles, per-product grouping).
 */
export function cartonKey(c: ParsedCarton): string | undefined {
  return c.gtin ?? c.itemCode;
}

/**
 * Parse a GS1-128 string (either raw scanner output or parenthesised form).
 * Auto-detects the form by the presence of "(".
 */
export function parseGS1(input: string): ParsedCarton {
  const raw = input;
  const cleaned = stripSymbologyId(input.trim());
  const { elements, errors } = cleaned.includes('(')
    ? tokenizeParenthesised(cleaned)
    : tokenizeRaw(cleaned);
  return buildCarton(raw, elements, errors);
}
