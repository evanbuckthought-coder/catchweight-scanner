/**
 * OCR (supplier/manufacturer) label profiles — where on a supplier's printed
 * label the weight/batch/dates live, so OCR capture can be steered per label.
 *
 * TODAY this store is empty: nothing in the app creates these yet. It exists
 * so Label Intelligence can list/manage them for real, and so the upcoming AI
 * "Teach a new label" tool has a ready home to write into. The shape is kept
 * deliberately minimal; the teach tool owns whatever it puts in `data`.
 */

import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export interface OcrLabelProfile {
  id: string;
  /** Display name — typically the supplier/manufacturer the label belongs to. */
  name: string;
  /** Optional free-text description (e.g. "blue Fribin carton, weight bottom-right"). */
  description?: string;
  updatedAt: string;
  /** Reserved for the AI teach tool's learned layout. Opaque here. */
  data?: unknown;
}

export function loadOcrProfiles(): OcrLabelProfile[] {
  return loadJSON<OcrLabelProfile[]>(STORAGE_KEYS.ocrProfiles, []);
}

export function removeOcrProfile(id: string): OcrLabelProfile[] {
  const rest = loadOcrProfiles().filter((p) => p.id !== id);
  saveJSON(STORAGE_KEYS.ocrProfiles, rest);
  return rest;
}
