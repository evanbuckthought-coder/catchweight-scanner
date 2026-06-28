/**
 * Client-side Excel export (SheetJS / xlsx community edition).
 *
 * Two sheets:
 *   1. Cartons  - per-carton rows GROUPED BY PRODUCT: a merged product banner,
 *                 the cartons, a product subtotal, a gap row, then the next
 *                 product; ends with an overall PO total row.
 *   2. Summary  - PO header + a per-product table + totals.
 *
 * Note: the community SheetJS build doesn't write cell styles (bold/fills), so
 * the visual break between products uses merged banner rows + UPPERCASE labels +
 * gap rows rather than bold text.
 */

import type * as XLSXType from 'xlsx';
import type { Session } from '../types';
import { poTotals, productSubtotal } from './session';
import { roundKg } from './units';

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

const CARTON_HEADERS = [
  'Scan time', 'Scanned by', 'Entry', 'PO Reference', 'Supplier', 'Brand', 'Product', 'GTIN',
  'Net weight', 'Unit', 'Weight (kg)', 'Batch/Lot', 'Serial', 'Production date',
  'Packaging date', 'Best before', 'Use by', 'Raw GS1 string',
];
const NCOLS = CARTON_HEADERS.length; // 18
const COL = { product: 6, weightKg: 10 } as const;

type Row = (string | number)[];

function cartonRow(c: Session['products'][number]['cartons'][number], session: Session): Row {
  return [
    formatDateTime(c.scanTime),
    c.scannedBy,
    c.manual ? 'Manual' : 'Scanned',
    c.poRef,
    c.supplier,
    c.brand ?? session.brand ?? '',
    c.product,
    c.gtin,
    c.netWeight,
    c.unit,
    roundKg(c.weightKg),
    c.batch ?? '',
    c.serial ?? '',
    c.productionDate ?? '',
    c.packagingDate ?? '',
    c.bestBefore ?? '',
    c.useBy ?? '',
    readableRaw(c.raw),
  ];
}

function emptyRow(): Row {
  return new Array(NCOLS).fill('');
}

function buildCartonsSheet(XLSX: XLSXModule, session: Session): XLSXType.WorkSheet {
  const aoa: Row[] = [CARTON_HEADERS];
  const merges: XLSXType.Range[] = [];
  let r = 1;

  for (const product of session.products) {
    // Merged product banner row (the visual break).
    const banner = `PRODUCT: ${product.product}    |    Supplier: ${session.supplier}${
      session.brand ? `    |    Brand: ${session.brand}` : ''
    }`;
    aoa.push([banner]);
    merges.push({ s: { r, c: 0 }, e: { r, c: NCOLS - 1 } });
    r++;

    for (const c of product.cartons) {
      aoa.push(cartonRow(c, session));
      r++;
    }

    const sub = productSubtotal(product);
    const subRow = emptyRow();
    subRow[0] = `SUBTOTAL — ${product.product}`;
    subRow[COL.product] = `${sub.count} carton${sub.count === 1 ? '' : 's'}`;
    subRow[COL.weightKg] = sub.kg;
    aoa.push(subRow);
    r++;

    aoa.push(emptyRow()); // gap before next product
    r++;
  }

  const totals = poTotals(session);
  const totalRow = emptyRow();
  totalRow[0] = 'PO TOTAL';
  totalRow[COL.product] = `${totals.cartonCount} carton${totals.cartonCount === 1 ? '' : 's'}`;
  totalRow[COL.weightKg] = totals.kg;
  aoa.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 20 }, { wch: 14 }, { wch: 9 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 18 },
    { wch: 16 }, { wch: 10 }, { wch: 6 }, { wch: 11 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 40 },
  ];
  return ws;
}

function buildSummarySheet(XLSX: XLSXModule, session: Session): XLSXType.WorkSheet {
  const totals = poTotals(session);
  const aoa: Row[] = [
    ['PO Reference', session.poRef],
    ['Date/time', formatDateTime(session.startedAt)],
    ['Scanned by', session.scannedBy],
    ['Supplier', session.supplier],
    ['Brand', session.brand ?? ''],
    [],
    ['Product', 'Cartons', 'Weight (kg)'],
    ...session.products.map((p) => {
      const sub = productSubtotal(p);
      return [p.product, sub.count, sub.kg] as Row;
    }),
    [],
    ['PO TOTAL', totals.cartonCount, totals.kg],
    ['Products', totals.productCount],
    ['Manual cartons', totals.manual],
    ['Mixed units', totals.mixedUnits ? 'Yes (kg + lb)' : 'No'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 12 }];
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
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(XLSX, session), 'Summary');
  return wb;
}

/** Build and trigger download of the workbook for a session. */
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
  const filename = `catchweight_${sanitiseFilenamePart(session.poRef)}_${ts}.xlsx`;

  XLSX.writeFile(wb, filename);
  return filename;
}
