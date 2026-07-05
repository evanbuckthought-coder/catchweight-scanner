/**
 * OCR (supplier/manufacturer) label profiles — where on a supplier's printed
 * label the weight/batch/dates live, so OCR capture can be steered per label.
 *
 * Created by the "Teach a new label" AI flow in Label Intelligence (one AI
 * call per label design, human-confirmed before saving). Profiles hold the
 * label's LAYOUT/FORMAT only — never a weight value to reuse: every carton's
 * actual weight is always read fresh at receiving time, and all guardrails
 * stay active regardless of what a profile says.
 */

import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';
import { suggestSupplier } from './suppliers';
import type { WeightUnit } from './units';

/** The learned layout "map" saved from a confirmed teach. */
export interface TaughtLabelMap {
  /** Unit the NET weight is printed in on this label design. */
  unit: WeightUnit | null;
  /** Decimal places of the printed net weight (e.g. 21.652 -> 3). */
  decimalPlaces: number | null;
  /** Where on the label the net weight sits (human-readable region). */
  weightRegion: string | null;
  /** Literal text printed beside the weight (e.g. "NET WEIGHT", "Net kg"). */
  anchorText: string | null;
  /** Barcode classification from the teach (e.g. carries weight vs plain ID). */
  barcodeType: string | null;
  /** Printed date formats seen on the label (e.g. "best-before: DD/MM/YYYY"). */
  dateFormats: string[];
  batchPresent: boolean;
  serialPresent: boolean;
  /** Provenance: which confirm-screen fields came from the AI unedited. */
  aiFields: string[];
  /** When this label was taught (ISO). */
  taughtAt: string;
}

export interface OcrLabelProfile {
  id: string;
  /** Display name — the manufacturer where identifiable, else the supplier. */
  name: string;
  /** Optional free-text description (e.g. the product on the taught carton). */
  description?: string;
  updatedAt: string;
  /** The learned layout, present once a label has been taught. */
  data?: TaughtLabelMap;
}

export function loadOcrProfiles(): OcrLabelProfile[] {
  return loadJSON<OcrLabelProfile[]>(STORAGE_KEYS.ocrProfiles, []);
}

export function removeOcrProfile(id: string): OcrLabelProfile[] {
  const rest = loadOcrProfiles().filter((p) => p.id !== id);
  saveJSON(STORAGE_KEYS.ocrProfiles, rest);
  return rest;
}

/**
 * Create or update a profile. Re-teaching the same supplier/manufacturer
 * replaces its map (matched case-insensitively on name) instead of piling up
 * duplicates.
 */
export function upsertOcrProfile(profile: OcrLabelProfile): OcrLabelProfile[] {
  const key = profile.name.trim().toLowerCase();
  const all = loadOcrProfiles();
  const existing = all.find((p) => p.name.trim().toLowerCase() === key);
  const next = existing
    ? all.map((p) => (p === existing ? { ...profile, id: existing.id } : p))
    : [profile, ...all];
  saveJSON(STORAGE_KEYS.ocrProfiles, next);
  return next;
}

/**
 * Company-form / category words that must never count as a name match on
 * their own ("Alliance GROUP" must not match "Danish Crown GROUP").
 */
const GENERIC_NAME_TOKENS = new Set([
  'limited', 'ltd', 'gmbh', 'inc', 'co', 'company', 'the', 'and',
  'meats', 'meat', 'foods', 'food', 'group', 'farms', 'farm', 'fleisch',
  'new', 'zealand', 'australia', 'export', 'exports',
]);

/** Distinctive name tokens: ≥4 chars and not a generic company/category word. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC_NAME_TOKENS.has(t));
}

/**
 * Find the taught profile matching a supplier/manufacturer name. Matches
 * case-insensitive substring either way ("Fribin" ↔ "Fribin Meats S.L."),
 * else on a shared distinctive token ("Alliance Group Ltd" ↔ "Alliance
 * Group Limited"). Used only to CONFIGURE OCR — never to skip a check.
 */
export function findTaughtProfile(supplierName: string): OcrLabelProfile | undefined {
  const key = supplierName.trim().toLowerCase();
  if (!key) return undefined;
  const taught = loadOcrProfiles().filter((p) => !!p.data);
  const bySubstring = taught.find((p) => {
    const name = p.name.trim().toLowerCase();
    return name === key || name.includes(key) || key.includes(name);
  });
  if (bySubstring) return bySubstring;
  const keyTokens = nameTokens(key);
  return taught.find((p) => nameTokens(p.name).some((t) => keyTokens.includes(t)));
}

/**
 * Resolve the label profile OCR mode must use for the current capture
 * context — AUTOMATICALLY, never by manual selection during receiving:
 * manufacturer via the product's GTIN prefix where a barcode has been
 * scanned, else the session's supplier. Undefined = label not taught yet,
 * and OCR mode must not run (the teach gate handles it).
 */
export function findProfileForCapture(
  gtin: string | undefined,
  supplier: string,
): OcrLabelProfile | undefined {
  const manufacturer = suggestSupplier(gtin);
  return (manufacturer ? findTaughtProfile(manufacturer) : undefined) ?? findTaughtProfile(supplier);
}

/** Short on-screen summary of a taught format, e.g. `kg · 2 dp · near “NET WEIGHT”`. */
export function taughtFormatHint(map: TaughtLabelMap): string {
  const parts = [
    map.unit ?? undefined,
    map.decimalPlaces != null ? `${map.decimalPlaces} dp` : undefined,
    map.anchorText ? `near “${map.anchorText}”` : undefined,
  ].filter(Boolean);
  return parts.join(' · ') || 'taught layout';
}
