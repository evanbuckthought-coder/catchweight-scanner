/**
 * Turn a parsed barcode + the human-confirmed names + session context into a
 * stored CartonRecord (one row of the traceability log / future EWM HU).
 */

import type { ParsedCarton } from './gs1';
import type { CartonRecord } from '../types';
import { uid } from './storage';

export interface CartonContext {
  scannedBy: string;
  receiptRef: string;
  product: string;
  supplier: string;
}

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
  };
}
