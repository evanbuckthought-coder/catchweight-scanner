/**
 * Session helpers: running totals, mixed-unit detection, and the variance /
 * HOLD decision that drives the goods-receipt + payment gate.
 */

import type { CartonRecord, Session, VarianceResult, VarianceStatus } from '../types';
import { roundKg } from './units';

/** Sum of normalised kg across all cartons. */
export function totalKg(cartons: CartonRecord[]): number {
  return roundKg(cartons.reduce((sum, c) => sum + c.weightKg, 0));
}

/** True if the session mixes kg and lb cartons (needs supervisor review). */
export function hasMixedUnits(cartons: CartonRecord[]): boolean {
  const units = new Set(cartons.map((c) => c.unit));
  return units.size > 1;
}

/**
 * Compute variance vs the expected receipt. Anything outside tolerance is a
 * HOLD. If no expectation was entered, the status is "match" with hold=false
 * (nothing to check against) — the UI shows it as informational only.
 */
export function computeVariance(session: Session): VarianceResult {
  const { cartons, expectation } = session;
  const receivedKg = totalKg(cartons);
  const receivedCartons = cartons.length;
  const tol = expectation.toleranceKg ?? 0;

  let status: VarianceStatus = 'match';
  let hold = false;
  let varianceKg: number | undefined;
  let varianceCartons: number | undefined;

  if (expectation.expectedKg !== undefined) {
    varianceKg = roundKg(receivedKg - expectation.expectedKg);
    if (varianceKg < -tol) {
      status = 'short';
      hold = true;
    } else if (varianceKg > tol) {
      status = 'over';
      hold = true;
    }
  }

  if (expectation.expectedCartons !== undefined) {
    varianceCartons = receivedCartons - expectation.expectedCartons;
    // A carton-count mismatch is always a hold regardless of weight tolerance.
    if (varianceCartons !== 0) {
      hold = true;
      if (status === 'match') status = varianceCartons < 0 ? 'short' : 'over';
    }
  }

  return {
    receivedKg,
    receivedCartons,
    expectedKg: expectation.expectedKg,
    expectedCartons: expectation.expectedCartons,
    varianceKg,
    varianceCartons,
    toleranceKg: tol,
    status,
    hold,
    mixedUnits: hasMixedUnits(cartons),
  };
}

/** Human label for the export "Status" column. */
export function statusLabel(v: VarianceResult): string {
  if (v.expectedKg === undefined && v.expectedCartons === undefined) return 'NO EXPECTED';
  if (!v.hold) return 'MATCH';
  return v.status === 'short' ? 'HOLD (SHORT)' : 'HOLD (OVER)';
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
