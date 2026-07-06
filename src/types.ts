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

/** How a carton's weight was captured. */
export type EntryMethod = 'scan' | 'ocr' | 'manual';

/** One captured carton (barcode-scanned, OCR-read, or manually keyed). */
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

  /** Original GS1 string (or raw OCR text), kept for audit. Empty for manual entries. */
  raw: string;
  /** weightAI|traceAI|companyPrefix — format-change detector ("ocr" for OCR reads). */
  fingerprint: string;
  /** How the weight was captured: barcode scan, OCR read, or manual keying. */
  entry: EntryMethod;
}

/**
 * A pallet within a product. A real data entity (not just a label) so it can
 * later carry a scanned identifier.
 */
export interface Pallet {
  id: string;
  /**
   * Fixed pallet number within its product, assigned at creation (max existing
   * + 1). NOT positional: deleting an earlier pallet must not renumber the
   * rest — the number is part of the pallet's identity in the export.
   */
  number: number;
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
  /** Confirmed product name (from the first-carton confirm, or a manual start). */
  product: string;
  /** GTIN that defines this product group. Empty until a barcode is scanned —
   *  a manually-started product may keep '' if no carton ever scans. */
  gtin: string;
  /** Fingerprint that defines this product group (label-change baseline). */
  fingerprint: string;
  startedAt: string;
  /** Pallets under this product, in order; pallet number = index + 1. */
  pallets: Pallet[];
  /**
   * True when the product was established via manual entry (its first carton
   * had no readable barcode). Combined with an empty `gtin`, means no barcode
   * was ever scanned for it — surfaced in review/export. Cleared implicitly
   * for reporting once a barcode is later adopted (gtin becomes non-empty).
   */
  startedManually?: boolean;
  /** Default batch/lot set at a manual start; seeds manual cartons until one
   *  carries its own batch. */
  batch?: string;
  /** Carton/label identifier read off the label by eye at a manual start
   *  (informational — shown in review/export). */
  cartonId?: string;
}

/** Saved per-GTIN profile so later scans auto-fill the product name. */
export interface GtinProfile {
  gtin: string;
  productName: string;
  supplierName: string;
  fingerprint: string;
  updatedAt: string;
  /** Provenance: set when this profile was created/updated by "Teach a new label". */
  source?: 'ai-teach';
  /** When the AI teach that produced this profile happened (ISO). */
  taughtAt?: string;
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
