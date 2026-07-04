/**
 * Per-GTIN profile store. The barcode gives us a GTIN but never the human names
 * (product / supplier), so the first time we see a GTIN the operator confirms
 * those and we remember them keyed by GTIN.
 */

import type { GtinProfile } from '../types';
import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export function loadProfiles(): Record<string, GtinProfile> {
  return loadJSON<Record<string, GtinProfile>>(STORAGE_KEYS.profiles, {});
}

export function getProfile(gtin: string): GtinProfile | undefined {
  return loadProfiles()[gtin];
}

/** Insert/update a profile and persist. Returns the full updated map. */
export function upsertProfile(profile: GtinProfile): Record<string, GtinProfile> {
  const all = loadProfiles();
  all[profile.gtin] = profile;
  saveJSON(STORAGE_KEYS.profiles, all);
  return all;
}

/**
 * Delete a profile ("relearn": the next scan of this GTIN raises the
 * first-carton confirm from scratch). Returns the full updated map.
 */
export function removeProfile(gtin: string): Record<string, GtinProfile> {
  const all = loadProfiles();
  delete all[gtin];
  saveJSON(STORAGE_KEYS.profiles, all);
  return all;
}
