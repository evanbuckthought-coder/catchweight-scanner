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
  return cartons.filter((c) => c.entry === 'manual').length;
}

/** Count of cartons whose weight was read by OCR. */
export function ocrCount(cartons: CartonRecord[]): number {
  return cartons.filter((c) => c.entry === 'ocr').length;
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
  ocr: number;
  mixedUnits: boolean;
} {
  const cartons = allCartons(session);
  return {
    productCount: session.products.length,
    palletCount: session.products.reduce((n, p) => n + p.pallets.length, 0),
    cartonCount: cartons.length,
    kg: totalKg(cartons),
    manual: manualCount(cartons),
    ocr: ocrCount(cartons),
    mixedUnits: hasMixedUnits(cartons),
  };
}

/** The next pallet number within a product (max existing + 1, never reused). */
export function nextPalletNumber(product: SessionProduct): number {
  return product.pallets.reduce((max, pl) => Math.max(max, pl.number), 0) + 1;
}

/** What a scanned label needs to expose for duplicate detection. */
export interface DuplicateProbe {
  gtin: string;
  serial?: string;
  raw: string;
}

/**
 * Find an existing carton that this scan duplicates.
 *
 * - Serial (AI 21) is unique per carton -> hard dedupe on GTIN + serial.
 * - Batch (AI 10) is shared by EVERY carton in the batch — it must NOT be used
 *   for dedupe (it would block all but the first carton of a batch-traced
 *   product). For batch-only labels, only an identical full raw string (a true
 *   re-scan: same GTIN, batch AND weight) counts as a duplicate. Two genuinely
 *   identical twin cartons would also match; the operator can add the second
 *   via manual entry if that ever happens.
 * - Manual/OCR cartons have raw '' / 'OCR: ...' and no serial, so they never
 *   participate in dedupe.
 */
export function findDuplicate(
  cartons: CartonRecord[],
  probe: DuplicateProbe,
): CartonRecord | undefined {
  if (probe.serial) {
    return cartons.find((c) => c.gtin === probe.gtin && c.serial === probe.serial);
  }
  if (probe.raw) {
    return cartons.find((c) => c.raw !== '' && c.raw === probe.raw);
  }
  return undefined;
}
