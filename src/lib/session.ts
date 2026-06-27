/**
 * Session helpers for a pure capture-and-tally tool: running kg total,
 * mixed-unit detection, and exact re-scan dedupe. (No expected/variance logic —
 * the app just counts what's scanned or keyed in.)
 */

import type { CartonRecord } from '../types';
import { roundKg } from './units';

/** Sum of normalised kg across all cartons. */
export function totalKg(cartons: CartonRecord[]): number {
  return roundKg(cartons.reduce((sum, c) => sum + c.weightKg, 0));
}

/** True if the session mixes kg and lb cartons (flag for supervisor review). */
export function hasMixedUnits(cartons: CartonRecord[]): boolean {
  const units = new Set(cartons.map((c) => c.unit));
  return units.size > 1;
}

/** Count of cartons whose weight was keyed in manually. */
export function manualCount(cartons: CartonRecord[]): number {
  return cartons.filter((c) => c.manual).length;
}

/** Find an existing carton with the same trace id (exact re-scan dedupe). */
export function findDuplicate(
  cartons: CartonRecord[],
  gtin: string,
  traceId: string | undefined,
): CartonRecord | undefined {
  if (!traceId) return undefined;
  return cartons.find((c) => c.gtin === gtin && c.traceId === traceId);
}
