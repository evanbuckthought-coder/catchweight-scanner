/**
 * Client-side Excel export (SheetJS / xlsx community edition).
 *
 * Two sheets:
 *   1. Cartons        - one row per scan; the traceability record.
 *   2. Receipt summary - one row for the session; drives the GR / payment hold.
 *
 * These columns are deliberately the same field set that will later map to an
 * SAP EWM inbound delivery (HU/item rows + GR header). xlsx is just today's
 * endpoint; the data model does not change when SAP integration lands.
 */

import type * as XLSXType from 'xlsx';
import type { Session } from '../types';
import { computeVariance, statusLabel } from './session';
import { roundKg } from './units';
import { suggestSupplier } from './suppliers';

// xlsx is the heaviest dependency; load it lazily on first export so it stays
// out of the initial bundle (matters on a phone over cellular).
type XLSXModule = typeof XLSXType;

/** Visible token for the FNC1/GS separator so the raw audit string is readable. */
function readableRaw(raw: string): string {
  return raw.replace(/\x1d/g, '{GS}');
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** Distinct supplier names seen in the session (for the summary row). */
function sessionSuppliers(session: Session): string {
  const names = new Set(
    session.cartons.map((c) => c.supplier || suggestSupplier(c.gtin) || '(unknown)'),
  );
  return [...names].join(', ');
}

function buildCartonsSheet(XLSX: XLSXModule, session: Session): XLSXType.WorkSheet {
  const rows = session.cartons.map((c) => ({
    'Scan time': formatDateTime(c.scanTime),
    'Scanned by': c.scannedBy,
    'Receipt/PO ref': c.receiptRef,
    Supplier: c.supplier,
    Product: c.product,
    GTIN: c.gtin,
    'Net weight': c.netWeight,
    Unit: c.unit,
    'Weight (kg)': roundKg(c.weightKg),
    'Batch/Lot': c.batch ?? '',
    Serial: c.serial ?? '',
    'Production date': c.productionDate ?? '',
    'Packaging date': c.packagingDate ?? '',
    'Best before': c.bestBefore ?? '',
    'Use by': c.useBy ?? '',
    'Raw GS1 string': readableRaw(c.raw),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  // Force GTIN + raw to text so Excel doesn't mangle long numbers into floats.
  // (json_to_sheet already writes strings as text; this is just header width.)
  ws['!cols'] = [
    { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 14 },
    { wch: 16 }, { wch: 10 }, { wch: 6 }, { wch: 11 }, { wch: 16 },
    { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 40 },
  ];
  return ws;
}

function buildSummarySheet(XLSX: XLSXModule, session: Session): XLSXType.WorkSheet {
  const v = computeVariance(session);
  const row = {
    'Receipt/PO ref': session.receiptRef,
    'Date/time': formatDateTime(session.startedAt),
    'Scanned by': session.scannedBy,
    Supplier: sessionSuppliers(session),
    'Carton count': v.receivedCartons,
    'Total kg': roundKg(v.receivedKg),
    'Expected kg': v.expectedKg ?? '',
    'Variance kg': v.varianceKg ?? '',
    'Expected ctns': v.expectedCartons ?? '',
    'Variance ctns': v.varianceCartons ?? '',
    Status: statusLabel(v) + (v.mixedUnits ? ' / MIXED UNITS' : ''),
  };
  const ws = XLSX.utils.json_to_sheet([row]);
  ws['!cols'] = [
    { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 12 },
    { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 13 }, { wch: 22 },
  ];
  return ws;
}

function sanitiseFilenamePart(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'session';
}

/** Build the two-sheet workbook (no download) — also used by tests. */
export async function buildWorkbook(session: Session): Promise<XLSXType.WorkBook> {
  const XLSX: XLSXModule = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildCartonsSheet(XLSX, session), 'Cartons');
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(XLSX, session), 'Receipt summary');
  return wb;
}

/** Build and trigger download of the two-sheet workbook for a session. */
export async function exportSessionToXlsx(session: Session): Promise<string> {
  const XLSX: XLSXModule = await import('xlsx');
  const wb = await buildWorkbook(session);

  const stamp = new Date(session.startedAt);
  const ts = Number.isNaN(stamp.getTime())
    ? 'session'
    : `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
        stamp.getDate(),
      ).padStart(2, '0')}_${String(stamp.getHours()).padStart(2, '0')}${String(
        stamp.getMinutes(),
      ).padStart(2, '0')}`;
  const filename = `catchweight_${sanitiseFilenamePart(session.receiptRef)}_${ts}.xlsx`;

  // writeFile builds the blob and triggers the browser download to the phone.
  XLSX.writeFile(wb, filename);
  return filename;
}
