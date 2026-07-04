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
 * Find the taught profile for a session's supplier (case-insensitive
 * substring match either way, so "Fribin" matches "Fribin Meats S.L.").
 * Used only to BIAS OCR defaults (e.g. assumed unit) — never to skip a check.
 */
export function findTaughtProfile(supplierName: string): OcrLabelProfile | undefined {
  const key = supplierName.trim().toLowerCase();
  if (!key) return undefined;
  return loadOcrProfiles().find((p) => {
    if (!p.data) return false;
    const name = p.name.trim().toLowerCase();
    return name === key || name.includes(key) || key.includes(name);
  });
}
