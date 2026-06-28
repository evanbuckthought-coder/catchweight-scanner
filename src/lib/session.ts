/**
 * Session helpers for a PO -> products -> cartons capture tool: running kg
 * subtotals (per product and overall), mixed-unit detection, and exact re-scan
 * dedupe (across the whole PO).
 */

import type { CartonRecord, Session, SessionProduct } from '../types';
import { roundKg } from './units';

/** Sum of normalised kg across the given cartons. */
export function totalKg(cartons: CartonRecord[]): number {
  return roundKg(cartons.reduce((sum, c) => sum + c.weightKg, 0));
}

/** True if the cartons mix kg and lb (flag for supervisor review). */
export function hasMixedUnits(cartons: CartonRecord[]): boolean {
  const units = new Set(cartons.map((c) => c.unit));
  return units.size > 1;
}

/** Count of cartons whose weight was keyed in manually. */
export function manualCount(cartons: CartonRecord[]): number {
  return cartons.filter((c) => c.manual).length;
}

/** Every carton across every product in the session, in order. */
export function allCartons(session: Session): CartonRecord[] {
  return session.products.flatMap((p) => p.cartons);
}

/** Per-product subtotal. */
export function productSubtotal(product: SessionProduct): { count: number; kg: number } {
  return { count: product.cartons.length, kg: totalKg(product.cartons) };
}

/** Overall PO totals. */
export function poTotals(session: Session): {
  productCount: number;
  cartonCount: number;
  kg: number;
  manual: number;
  mixedUnits: boolean;
} {
  const cartons = allCartons(session);
  return {
    productCount: session.products.length,
    cartonCount: cartons.length,
    kg: totalKg(cartons),
    manual: manualCount(cartons),
    mixedUnits: hasMixedUnits(cartons),
  };
}

/** Find an existing carton with the same GTIN + trace id (exact re-scan dedupe). */
export function findDuplicate(
  cartons: CartonRecord[],
  gtin: string,
  traceId: string | undefined,
): CartonRecord | undefined {
  if (!traceId) return undefined;
  return cartons.find((c) => c.gtin === gtin && c.traceId === traceId);
}
