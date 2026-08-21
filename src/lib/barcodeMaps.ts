/**
 * Custom barcode FORMAT MAPS — for cartons whose barcode is not GS1 but does
 * carry a weight (e.g. a legacy 20-digit NZ meat carton code).
 *
 * === THE ONE RULE ===
 * The AI teaches the MAP (which digit positions mean what). It NEVER supplies
 * a value that lands in a tally. The AI has demonstrably misread digits from
 * photos, so every decoded value comes from the SCANNER's own exact digit
 * string, decoded on-device by the pure functions below. The AI's reading of
 * the printed label is used only to derive the structure, and only ever shown
 * to the human for confirmation.
 *
 * Everything here is pure + offline. The only online moment in the whole
 * feature is the single teach call that proposes a map.
 */

import { STORAGE_KEYS, loadJSON, saveJSON, uid } from './storage';
import { toKg, type WeightUnit } from './units';

// --- plausibility guards (applied at teach time AND on every later scan) ----

/** A single meat carton weighs between these, in kg. Outside -> refuse. */
export const MIN_CARTON_KG = 1;
export const MAX_CARTON_KG = 40;
/** A production date older than this is implausible for stock being received. */
export const MAX_AGE_YEARS = 10;
/** Below this, the AI isn't sure enough about the weight field to trust the map. */
export const MIN_WEIGHT_CONFIDENCE = 0.7;

// --- map shape (mirrors the AI response schema) -----------------------------

export interface BarcodeFieldSpec {
  /** 0-indexed start position in the scanned digit string. */
  start: number;
  length: number;
  /** What the AI read for this field on the printed label (evidence only). */
  printedValueSeen?: string | null;
  confidence: number;
}

export interface BarcodeWeightSpec extends BarcodeFieldSpec {
  encoding: 'integer' | 'decimal-implied';
  /** value = digits * multiplier (e.g. 153 * 0.1 = 15.3). */
  multiplier: number;
  unit: WeightUnit;
}

export type DateEncoding = 'yy-dayofyear' | 'yymmdd' | 'ddmmyy' | 'yyyymmdd' | 'other';

export interface BarcodeDateSpec extends BarcodeFieldSpec {
  encoding: DateEncoding;
}

export interface BarcodeFormatMap {
  formatName: string;
  totalLength: number;
  fields: {
    netWeight: BarcodeWeightSpec | null;
    productionDate: BarcodeDateSpec | null;
    productCode: BarcodeFieldSpec | null;
    serial: BarcodeFieldSpec | null;
    bestBefore: BarcodeDateSpec | null;
  };
  /** How a future scan is recognised as this format. */
  signature: { length: number; prefix: string | null; prefixLength: number };
  /** The AI's own cross-check claims — verified independently in code. */
  verification: {
    weightMatchesPrinted: boolean;
    dateMatchesPrinted: boolean;
    notes: string | null;
  };
}

/** A validated, human-confirmed map stored on the device. */
export interface SavedBarcodeMap extends BarcodeFormatMap {
  id: string;
  savedAt: string;
  /** The exact scanned string this was taught from — audit trail. */
  sampleRaw: string;
}

/** What decoding a barcode with a map yields — all from the scanner's digits. */
export interface DecodedBarcode {
  formatName: string;
  netWeight: number;
  unit: WeightUnit;
  weightKg: number;
  productionDate?: string;
  bestBefore?: string;
  productCode?: string;
  serial?: string;
}

export type DecodeResult =
  | { ok: true; decoded: DecodedBarcode }
  | { ok: false; reason: string };

// --- date decoding ----------------------------------------------------------

/** Build an ISO date, rejecting anything the calendar doesn't actually have. */
function isoDate(year: number, month1: number, day: number): string | null {
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month1 - 1, day));
  // Rolled over (e.g. 31 Feb) -> not a real date.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month1 - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/** Decode a date field's digits per its encoding, or null if impossible. */
export function decodeDateField(digits: string, encoding: DateEncoding): string | null {
  if (!/^\d+$/.test(digits)) return null;
  switch (encoding) {
    case 'yy-dayofyear': {
      if (digits.length !== 5) return null;
      const year = 2000 + Number(digits.slice(0, 2));
      const doy = Number(digits.slice(2, 5));
      if (doy < 1 || doy > 366) return null;
      const d = new Date(Date.UTC(year, 0, doy));
      // Day 366 of a non-leap year would roll into January — reject.
      if (d.getUTCFullYear() !== year) return null;
      return d.toISOString().slice(0, 10);
    }
    case 'yymmdd':
      if (digits.length !== 6) return null;
      return isoDate(2000 + Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4, 6)));
    case 'ddmmyy':
      if (digits.length !== 6) return null;
      return isoDate(2000 + Number(digits.slice(4, 6)), Number(digits.slice(2, 4)), Number(digits.slice(0, 2)));
    case 'yyyymmdd':
      if (digits.length !== 8) return null;
      return isoDate(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
    case 'other':
    default:
      return null;
  }
}

/** Is a production date plausible: a real date, not future, not ancient? */
function productionDatePlausible(iso: string, now: number): boolean {
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  if (!Number.isFinite(t)) return false;
  // One day of slack absorbs timezone differences between device and label.
  if (t > now + 24 * 3600_000) return false;
  return t >= now - MAX_AGE_YEARS * 365.25 * 24 * 3600_000;
}

// --- the decoder (scanner digits in, carton fields out) ----------------------

/** Does this barcode look like the format the map describes? */
export function signatureMatches(raw: string, map: BarcodeFormatMap): boolean {
  const s = raw.trim();
  if (s.length !== map.signature.length) return false;
  const prefix = map.signature.prefix;
  if (prefix && !s.startsWith(prefix)) return false;
  return true;
}

function slice(raw: string, f: BarcodeFieldSpec): string | null {
  if (!Number.isInteger(f.start) || !Number.isInteger(f.length) || f.start < 0 || f.length <= 0) return null;
  if (f.start + f.length > raw.length) return null;
  return raw.slice(f.start, f.start + f.length);
}

/**
 * Decode a scanned barcode with a map — the ONLY path a custom-format weight
 * can enter the app. Re-validates on every call (spec: never count an
 * unvalidated value), so a map that drifts or meets an odd barcode refuses
 * rather than producing a wrong weight.
 */
export function decodeWithMap(
  raw: string,
  map: BarcodeFormatMap,
  now: number = Date.now(),
): DecodeResult {
  const s = raw.trim();
  if (!signatureMatches(s, map)) return { ok: false, reason: 'Barcode does not match this saved format' };

  const w = map.fields.netWeight;
  if (!w) return { ok: false, reason: 'Saved format has no weight field' };
  const wd = slice(s, w);
  if (wd === null || !/^\d+$/.test(wd)) return { ok: false, reason: 'Weight digits missing from this barcode' };
  if (!Number.isFinite(w.multiplier) || w.multiplier <= 0) return { ok: false, reason: 'Saved format has an invalid weight multiplier' };

  const netWeight = Number(wd) * w.multiplier;
  const weightKg = toKg(netWeight, w.unit);
  if (!(weightKg >= MIN_CARTON_KG && weightKg <= MAX_CARTON_KG)) {
    return {
      ok: false,
      reason: `Decoded ${weightKg.toFixed(2)} kg — outside the ${MIN_CARTON_KG}–${MAX_CARTON_KG} kg carton range, so it was not counted`,
    };
  }

  const decoded: DecodedBarcode = {
    formatName: map.formatName,
    netWeight,
    unit: w.unit,
    weightKg,
  };

  const pd = map.fields.productionDate;
  if (pd && pd.encoding !== 'other') {
    const digits = slice(s, pd);
    const iso = digits === null ? null : decodeDateField(digits, pd.encoding);
    if (!iso) return { ok: false, reason: 'Production date in this barcode is not a valid date' };
    if (!productionDatePlausible(iso, now)) {
      return { ok: false, reason: `Production date ${iso} is implausible (future or over ${MAX_AGE_YEARS} years old)` };
    }
    decoded.productionDate = iso;
  }

  const bb = map.fields.bestBefore;
  if (bb && bb.encoding !== 'other') {
    const digits = slice(s, bb);
    const iso = digits === null ? null : decodeDateField(digits, bb.encoding);
    // A best-before is supporting information, not a gate: an unreadable one
    // is dropped rather than refusing an otherwise-good carton weight.
    if (iso) decoded.bestBefore = iso;
  }

  const pc = map.fields.productCode;
  if (pc) {
    const v = slice(s, pc);
    if (v) decoded.productCode = v;
  }
  const sn = map.fields.serial;
  if (sn) {
    const v = slice(s, sn);
    if (v) decoded.serial = v;
  }

  return { ok: true, decoded };
}

/**
 * Validate a map the AI has just proposed, BEFORE it can be saved. The AI's
 * own verification flags are necessary but never sufficient — the map is
 * re-applied to the real scanned string here and the result must stand up.
 */
export function validateProposedMap(
  map: BarcodeFormatMap,
  scannedRaw: string,
  now: number = Date.now(),
): DecodeResult {
  const w = map.fields.netWeight;
  if (!w) return { ok: false, reason: 'The AI could not find a weight in this barcode — enter cartons manually.' };
  if (!map.verification?.weightMatchesPrinted) {
    return {
      ok: false,
      reason: 'The AI could not make the barcode digits reproduce the printed weight, so the format was not saved.',
    };
  }
  if (!(typeof w.confidence === 'number') || w.confidence < MIN_WEIGHT_CONFIDENCE) {
    return {
      ok: false,
      reason: `Confidence in the weight field is too low (${Math.round((w.confidence ?? 0) * 100)}%) — not saved.`,
    };
  }
  const s = scannedRaw.trim();
  if (map.signature.length !== s.length) {
    return { ok: false, reason: 'The proposed format length does not match the barcode that was scanned.' };
  }
  if (map.signature.prefix && !s.startsWith(map.signature.prefix)) {
    return { ok: false, reason: 'The proposed format prefix does not match the barcode that was scanned.' };
  }
  // The real test: decode the ACTUAL scanned digits with the proposed map.
  return decodeWithMap(s, map, now);
}

// --- untrusted input -> map -------------------------------------------------

const DATE_ENCODINGS: DateEncoding[] = ['yy-dayofyear', 'yymmdd', 'ddmmyy', 'yyyymmdd', 'other'];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readField(v: unknown): BarcodeFieldSpec | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const start = num(o.start);
  const length = num(o.length);
  if (start === null || length === null || !Number.isInteger(start) || !Number.isInteger(length)) return null;
  if (start < 0 || length <= 0) return null;
  return {
    start,
    length,
    printedValueSeen: typeof o.printedValueSeen === 'string' ? o.printedValueSeen : null,
    confidence: num(o.confidence) ?? 0,
  };
}

function readDateField(v: unknown): BarcodeDateSpec | null {
  const base = readField(v);
  if (!base) return null;
  const enc = (v as Record<string, unknown>).encoding;
  if (typeof enc !== 'string' || !DATE_ENCODINGS.includes(enc as DateEncoding)) return null;
  return { ...base, encoding: enc as DateEncoding };
}

/**
 * Convert an AI response into a BarcodeFormatMap, or null if it isn't one.
 * Structured outputs should guarantee the shape; this is the belt to that
 * pair of braces — nothing untyped reaches the decoder.
 */
export function coerceBarcodeMap(input: unknown): BarcodeFormatMap | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  const fieldsRaw = o.fields;
  const sigRaw = o.signature;
  if (typeof fieldsRaw !== 'object' || fieldsRaw === null) return null;
  if (typeof sigRaw !== 'object' || sigRaw === null) return null;
  const f = fieldsRaw as Record<string, unknown>;
  const s = sigRaw as Record<string, unknown>;

  const sigLength = num(s.length);
  if (sigLength === null || !Number.isInteger(sigLength) || sigLength <= 0) return null;

  // Net weight carries extra required parts; anything missing -> no map.
  let netWeight: BarcodeWeightSpec | null = null;
  const wBase = readField(f.netWeight);
  if (wBase) {
    const w = f.netWeight as Record<string, unknown>;
    const multiplier = num(w.multiplier);
    const unit = w.unit === 'kg' || w.unit === 'lb' ? w.unit : null;
    const encoding = w.encoding === 'decimal-implied' ? 'decimal-implied' : 'integer';
    if (multiplier === null || multiplier <= 0 || !unit) return null;
    netWeight = { ...wBase, encoding, multiplier, unit };
  }

  const ver = (typeof o.verification === 'object' && o.verification !== null
    ? (o.verification as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  return {
    formatName: typeof o.formatName === 'string' && o.formatName.trim() ? o.formatName.trim() : 'Custom barcode format',
    totalLength: num(o.totalLength) ?? sigLength,
    fields: {
      netWeight,
      productionDate: readDateField(f.productionDate),
      productCode: readField(f.productCode),
      serial: readField(f.serial),
      bestBefore: readDateField(f.bestBefore),
    },
    signature: {
      length: sigLength,
      prefix: typeof s.prefix === 'string' && s.prefix.length > 0 ? s.prefix : null,
      prefixLength: num(s.prefixLength) ?? (typeof s.prefix === 'string' ? s.prefix.length : 0),
    },
    verification: {
      weightMatchesPrinted: ver.weightMatchesPrinted === true,
      dateMatchesPrinted: ver.dateMatchesPrinted === true,
      notes: typeof ver.notes === 'string' ? ver.notes : null,
    },
  };
}

// --- storage ----------------------------------------------------------------

export function loadBarcodeMaps(): SavedBarcodeMap[] {
  return loadJSON<SavedBarcodeMap[]>(STORAGE_KEYS.barcodeMaps, []);
}

export function saveBarcodeMap(map: BarcodeFormatMap, sampleRaw: string): SavedBarcodeMap {
  const record: SavedBarcodeMap = {
    ...map,
    id: uid(),
    savedAt: new Date().toISOString(),
    sampleRaw,
  };
  saveJSON(STORAGE_KEYS.barcodeMaps, [record, ...loadBarcodeMaps()]);
  return record;
}

export function removeBarcodeMap(id: string): SavedBarcodeMap[] {
  const rest = loadBarcodeMaps().filter((m) => m.id !== id);
  saveJSON(STORAGE_KEYS.barcodeMaps, rest);
  return rest;
}

// --- lookup across saved maps -----------------------------------------------

export type MapLookup =
  | { kind: 'none' }
  | { kind: 'ambiguous'; maps: SavedBarcodeMap[] }
  | { kind: 'decoded'; decoded: DecodedBarcode; map: SavedBarcodeMap }
  | { kind: 'invalid'; reason: string; map: SavedBarcodeMap };

/**
 * Find and apply a saved map for a scanned barcode.
 *
 * Ambiguity is never resolved by guessing: if two saved maps could both claim
 * the barcode, the caller is told and falls back to manual entry.
 */
export function decodeWithSavedMaps(
  raw: string,
  maps: SavedBarcodeMap[] = loadBarcodeMaps(),
  now: number = Date.now(),
): MapLookup {
  const candidates = maps.filter((m) => signatureMatches(raw, m));
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length > 1) return { kind: 'ambiguous', maps: candidates };
  const map = candidates[0];
  const res = decodeWithMap(raw, map, now);
  return res.ok ? { kind: 'decoded', decoded: res.decoded, map } : { kind: 'invalid', reason: res.reason, map };
}

// --- per-session trust ------------------------------------------------------

/**
 * Maps whose decode a human has eyeballed against a real carton THIS run.
 * A freshly taught map is confirmed by its teach screen; a map loaded from a
 * previous session asks for one confirmation on its first scan of the run.
 * Module-level (not persisted) so every app launch re-verifies once.
 */
const confirmedThisSession = new Set<string>();

export function isMapConfirmedThisSession(id: string): boolean {
  return confirmedThisSession.has(id);
}

export function markMapConfirmed(id: string): void {
  confirmedThisSession.add(id);
}

/** Test seam — forget this run's confirmations. */
export function resetSessionConfirmations(): void {
  confirmedThisSession.clear();
}

/**
 * Values for ONE carton, confirmed by a human after an AI read of a label
 * whose barcode could not be scanned at all.
 *
 * Deliberately NOT a DecodedBarcode: nothing here came from a barcode, so it
 * carries no format map, teaches nothing, and must be recorded as AI-assisted
 * rather than scanned wherever it lands.
 */
export interface ConfirmedCartonRead {
  weightKg: number;
  netWeight: number;
  unit: WeightUnit;
  productionDate?: string;
  bestBefore?: string;
  useBy?: string;
  product?: string;
  productCode?: string;
  batch?: string;
  serial?: string;
  /** The weight exactly as the AI read it printed — audit trail only. */
  printedWeight?: string;
}
