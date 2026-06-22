/**
 * Shared data model for the Catchweight Scanner.
 *
 * NB: the carton + session field sets below are intentionally the same shape we
 * would later map to an SAP EWM inbound delivery (handling unit / delivery item
 * + GR header). The xlsx export is just the current endpoint — when the native
 * SAP stage lands, these records feed the inbound delivery instead of a sheet.
 */

import type { WeightUnit } from './lib/units';

/** One scanned carton — one row in the Cartons sheet / one EWM HU later. */
export interface CartonRecord {
  /** Local unique id (for list keys + removal). */
  id: string;
  /** ISO timestamp of the scan. */
  scanTime: string;
  /** Operator name (from settings; future: SSO identity). */
  scannedBy: string;
  /** Receipt / PO reference this carton was counted against. */
  receiptRef: string;

  supplier: string;
  product: string;
  gtin: string;

  /** Net weight in its labelled unit. */
  netWeight: number;
  unit: WeightUnit;
  /** Normalised weight in kilograms (what the pallet total sums). */
  weightKg: number;

  batch?: string;
  serial?: string;
  /** batch (10) if present, else serial (21). */
  traceId?: string;
  traceAI?: string;

  productionDate?: string;
  packagingDate?: string;
  bestBefore?: string;
  useBy?: string;

  /** Original GS1 string, kept for audit. */
  raw: string;
  /** weightAI|traceAI|companyPrefix — format change detector. */
  fingerprint: string;
}

/** Saved per-GTIN profile so later scans auto-fill product + supplier. */
export interface GtinProfile {
  gtin: string;
  productName: string;
  supplierName: string;
  /** Last confirmed format fingerprint for this GTIN. */
  fingerprint: string;
  updatedAt: string;
}

/** Expected receipt figures + tolerance for variance checking. */
export interface ReceiptExpectation {
  /** Expected total net weight in kg (optional). */
  expectedKg?: number;
  /** Expected carton count (optional). */
  expectedCartons?: number;
  /** Absolute kg tolerance band. Default 0 (exact). */
  toleranceKg: number;
}

/** A counting session against one receipt / PO. */
export interface Session {
  id: string;
  receiptRef: string;
  startedAt: string;
  scannedBy: string;
  expectation: ReceiptExpectation;
  cartons: CartonRecord[];
}

export type VarianceStatus = 'match' | 'short' | 'over';

/** Computed variance + GR/payment hold decision for a session. */
export interface VarianceResult {
  receivedKg: number;
  receivedCartons: number;
  expectedKg?: number;
  expectedCartons?: number;
  varianceKg?: number;
  varianceCartons?: number;
  toleranceKg: number;
  status: VarianceStatus;
  /** True = outside tolerance => goods receipt / payment HOLD. */
  hold: boolean;
  /** True if the session mixed kg + lb cartons (supervisor review). */
  mixedUnits: boolean;
}
