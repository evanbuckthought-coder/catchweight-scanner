/**
 * Session helpers for a PO -> products -> pallets -> cartons capture tool:
 * subtotals at each level, mixed-unit detection, and exact re-scan dedupe.
 */

import type { CartonRecord, Pallet, Session, SessionProduct } from '../types';
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

/** Cartons across all pallets of a product, in order. */
export function productCartons(product: SessionProduct): CartonRecord[] {
  return product.pallets.flatMap((pl) => pl.cartons);
}

/** Every carton across every product/pallet in the session, in order. */
export function allCartons(session: Session): CartonRecord[] {
  return session.products.flatMap(productCartons);
}

/** Per-pallet subtotal. */
export function palletSubtotal(pallet: Pallet): { count: number; kg: number } {
  return { count: pallet.cartons.length, kg: totalKg(pallet.cartons) };
}

/** Per-product subtotal (across its pallets). */
export function productSubtotal(product: SessionProduct): { count: number; kg: number } {
  const cartons = productCartons(product);
  return { count: cartons.length, kg: totalKg(cartons) };
}

/** Overall PO totals. */
export function poTotals(session: Session): {
  productCount: number;
  palletCount: number;
  cartonCount: number;
  kg: number;
  manual: number;
  mixedUnits: boolean;
} {
  const cartons = allCartons(session);
  return {
    productCount: session.products.length,
    palletCount: session.products.reduce((n, p) => n + p.pallets.length, 0),
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
