/**
 * Build stored CartonRecords from a scanned barcode or a manual keyed entry.
 * Product/supplier/brand/PO come from the session + active product context;
 * manual entries inherit them silently.
 */

import type { ParsedCarton } from './gs1';
import type { CartonRecord, EntryMethod } from '../types';
import { toKg, type WeightUnit } from './units';
import { uid } from './storage';

/** Session + active-product context shared by every carton. */
export interface CartonContext {
  scannedBy: string;
  poRef: string;
  supplier: string;
  brand?: string;
  /** Product group this carton belongs to. */
  product: string;
  /** How the weight was captured. Defaults to a barcode scan. */
  entry?: EntryMethod;
}

/** Build a record from a scanned/parsed barcode. */
export function toCartonRecord(parsed: ParsedCarton, ctx: CartonContext): CartonRecord {
  return {
    id: uid(),
    scanTime: new Date().toISOString(),
    scannedBy: ctx.scannedBy,
    poRef: ctx.poRef,
    supplier: ctx.supplier,
    brand: ctx.brand,
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
    entry: ctx.entry ?? 'scan',
  };
}

/** Fields the operator keys in for a damaged barcode (rest inherited). */
export interface ManualEntryInput {
  netWeight: number;
  unit: WeightUnit;
  /** Batch/lot — pre-filled from the current product, editable. */
  batch?: string;
}

/** Manual-entry context = scan context + the inherited GTIN and dates of the product. */
export interface ManualCartonContext extends CartonContext {
  gtin: string;
  /** Production date inherited from the manual product start (ISO YYYY-MM-DD). */
  productionDate?: string;
  /** Best-before inherited from the manual product start (ISO YYYY-MM-DD). */
  bestBefore?: string;
}

/** Build a record from a manual keyed entry (flagged manual: true). */
export function toManualCartonRecord(
  input: ManualEntryInput,
  ctx: ManualCartonContext,
): CartonRecord {
  const batch = input.batch?.trim() || undefined;
  return {
    id: uid(),
    scanTime: new Date().toISOString(),
    scannedBy: ctx.scannedBy,
    poRef: ctx.poRef,
    supplier: ctx.supplier,
    brand: ctx.brand,
    product: ctx.product,
    gtin: ctx.gtin,
    netWeight: input.netWeight,
    unit: input.unit,
    weightKg: toKg(input.netWeight, input.unit),
    batch,
    serial: undefined,
    traceId: batch,
    traceAI: batch ? '10' : undefined,
    productionDate: ctx.productionDate,
    packagingDate: undefined,
    bestBefore: ctx.bestBefore,
    useBy: undefined,
    raw: '',
    fingerprint: ctx.gtin ? `manual|${batch ? '10' : '?'}|${ctx.gtin.slice(0, 7)}` : 'manual',
    entry: 'manual',
  };
}
