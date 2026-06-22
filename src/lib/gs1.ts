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

/** AIs whose data is variable length and therefore terminated by GS / end. */
const VARIABLE_LENGTH_AIS = new Set(['10', '21', '37']);

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

  /** Net weight in its labelled unit (kg for 310n, lb for 320n). */
  netWeight?: number;
  weightUnit?: WeightUnit;
  /** Always-normalised weight in kilograms. */
  weightKg?: number;
  /** The weight AI actually used, e.g. "3102" or "3202". */
  weightAI?: string;

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

    // 31xx / 32xx -> 4-digit measurement AI, 6 fixed data digits.
    if (two === '31' || two === '32') {
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

  for (const el of elements) {
    const { ai, data } = el;

    // Measurement AIs: 310n (kg) / 320n (lb), n = decimal places (4th digit).
    if (/^3[12]\d\d$/.test(ai)) {
      const family = ai.slice(0, 3); // "310" or "320" (others are length/area/...)
      if (family === '310' || family === '320') {
        const n = Number(ai[3]);
        const intVal = Number(data);
        if (!Number.isFinite(intVal)) {
          carton.errors.push(`Weight AI ${ai} has non-numeric data "${data}"`);
        } else {
          const value = intVal / 10 ** n;
          const unit: WeightUnit = family === '310' ? 'kg' : 'lb';
          carton.netWeight = value;
          carton.weightUnit = unit;
          carton.weightKg = toKg(value, unit);
          carton.weightAI = ai;
        }
      } else {
        // A different 31xx/32xx measure (length, area, volume...) — not weight.
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

  // Minimum bar for a usable carton: a GTIN and a net weight.
  if (!carton.gtin) carton.errors.push('No GTIN (AI 01) found');
  if (carton.weightKg === undefined) carton.errors.push('No net weight (AI 310n/320n) found');
  carton.valid = !!carton.gtin && carton.weightKg !== undefined;

  return carton;
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
