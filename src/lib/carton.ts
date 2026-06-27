/**
 * Turn a parsed barcode (or a manual keyed entry) + the confirmed names +
 * session context into a stored CartonRecord (one row of the traceability log /
 * future EWM HU).
 */

import type { ParsedCarton } from './gs1';
import type { CartonRecord } from '../types';
import { toKg, type WeightUnit } from './units';
import { uid } from './storage';

export interface CartonContext {
  scannedBy: string;
  receiptRef: string;
  product: string;
  supplier: string;
}

/** Build a record from a scanned/parsed barcode. */
export function toCartonRecord(parsed: ParsedCarton, ctx: CartonContext): CartonRecord {
  return {
    id: uid(),
    scanTime: new Date().toISOString(),
    scannedBy: ctx.scannedBy,
    receiptRef: ctx.receiptRef,
    supplier: ctx.supplier,
    product: ctx.product,
    gtin: parsed.gtin ?? '',
    netWeight: parsed.netWeight ?? 0,
    unit: parsed.weightUnit ?? 'kg',
    weightKg: parsed.weightKg ?? 0,
    batch: parsed.batch,
    serial: parsed.serial,
    traceId: parsed.traceId,
    traceAI: parsed.traceAI,
    productionDate: parsed.productionDate,
    packagingDate: parsed.packagingDate,
    bestBefore: parsed.bestBefore,
    useBy: parsed.useBy,
    raw: parsed.raw,
    fingerprint: parsed.fingerprint ?? '',
    manual: false,
  };
}

/** Fields the operator keys in when a barcode can't be scanned. */
export interface ManualEntryInput {
  netWeight: number;
  unit: WeightUnit;
  product: string;
  supplier: string;
  /** Optional GTIN if the human-readable code is legible. */
  gtin?: string;
  /** Optional batch/lot for traceability. */
  batch?: string;
}

/** Build a record from a manual keyed entry (flagged manual: true). */
export function toManualCartonRecord(
  input: ManualEntryInput,
  ctx: { scannedBy: string; receiptRef: string },
): CartonRecord {
  const gtin = input.gtin?.trim() ?? '';
  const batch = input.batch?.trim() || undefined;
  return {
    id: uid(),
    scanTime: new Date().toISOString(),
    scannedBy: ctx.scannedBy,
    receiptRef: ctx.receiptRef,
    supplier: input.supplier.trim(),
    product: input.product.trim(),
    gtin,
    netWeight: input.netWeight,
    unit: input.unit,
    weightKg: toKg(input.netWeight, input.unit),
    batch,
    serial: undefined,
    traceId: batch,
    traceAI: batch ? '10' : undefined,
    productionDate: undefined,
    packagingDate: undefined,
    bestBefore: undefined,
    useBy: undefined,
    raw: '',
    fingerprint: gtin ? `manual|${batch ? '10' : '?'}|${gtin.slice(0, 7)}` : 'manual',
    manual: true,
  };
}
