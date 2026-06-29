/**
 * Shared data model for the Catchweight Scanner.
 *
 * Hierarchy: one PO session -> products -> pallets -> cartons. Supplier and
 * brand are set once at the PO level; each product keeps the GTIN/fingerprint
 * that defines it (for label-change detection) and a list of pallets; each
 * pallet holds its own cartons.
 *
 * NB: the carton field set is intentionally the same shape we'd later map to an
 * SAP EWM inbound delivery (handling unit / delivery item). The xlsx export is
 * just the current endpoint.
 */

import type { WeightUnit } from './lib/units';

/** One captured carton (scanned or manually keyed). */
export interface CartonRecord {
  id: string;
  scanTime: string;
  scannedBy: string;
  /** PO reference (session level). */
  poRef: string;
  /** Supplier (session level). */
  supplier: string;
  /** Brand, if different from supplier (session level, optional). */
  brand?: string;
  /** Product name (the product group this carton belongs to). */
  product: string;
  gtin: string;

  netWeight: number;
  unit: WeightUnit;
  /** Normalised weight in kilograms (what totals sum). */
  weightKg: number;

  batch?: string;
  serial?: string;
  traceId?: string;
  traceAI?: string;

  productionDate?: string;
  packagingDate?: string;
  bestBefore?: string;
  useBy?: string;

  /** Original GS1 string, kept for audit. Empty for manual entries. */
  raw: string;
  /** weightAI|traceAI|companyPrefix — format-change detector. */
  fingerprint: string;
  /** True if the weight was keyed in by hand (unreadable barcode). */
  manual: boolean;
}

/**
 * A pallet within a product. A real data entity (not just a label) so it can
 * later carry a scanned identifier.
 */
export interface Pallet {
  id: string;
  /**
   * Optional pallet identifier. Empty for now; future: populated by scanning the
   * pallet's SSCC barcode (GS1 AI 00) to auto-start a pallet and link its id to
   * the cartons for traceability.
   */
  palletId?: string;
  startedAt: string;
  cartons: CartonRecord[];
}

/** A product group within a PO session. */
export interface SessionProduct {
  id: string;
  /** Confirmed product name (from the first-carton confirm). */
  product: string;
  /** GTIN that defines this product group (from its first carton). */
  gtin: string;
  /** Fingerprint that defines this product group (label-change baseline). */
  fingerprint: string;
  startedAt: string;
  /** Pallets under this product, in order; pallet number = index + 1. */
  pallets: Pallet[];
}

/** Saved per-GTIN profile so later scans auto-fill the product name. */
export interface GtinProfile {
  gtin: string;
  productName: string;
  supplierName: string;
  fingerprint: string;
  updatedAt: string;
}

/** A capture-and-tally session against one PO. */
export interface Session {
  id: string;
  /** PO reference. */
  poRef: string;
  /** Supplier (compulsory). */
  supplier: string;
  /** Brand, if different from supplier (optional). */
  brand?: string;
  startedAt: string;
  scannedBy: string;
  /** Products captured under this PO, in capture order. */
  products: SessionProduct[];
  /** The product currently being captured, or null when between products. */
  activeProductId: string | null;
  /** The pallet currently being captured, or null when between pallets. */
  activePalletId: string | null;
}
