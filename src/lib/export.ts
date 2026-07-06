/**
 * Client-side Excel export (SheetJS / xlsx community edition).
 *
 * Two sheets:
 *   1. Cartons  - per-carton rows GROUPED BY PRODUCT then PALLET: a merged
 *                 product banner, then for each pallet a merged pallet banner,
 *                 its cartons, a pallet subtotal and a gap; then a product
 *                 subtotal and a gap; ending in an overall PO total row.
 *   2. Summary  - PO header + a product/pallet breakdown + totals.
 *
 * Note: the community SheetJS build doesn't write cell styles (bold/fills), so
 * the visual breaks use merged banner rows + UPPERCASE labels + gap rows.
 */

import type * as XLSXType from 'xlsx';
import type { CartonRecord, Pallet, Session, SessionProduct } from '../types';
import { allCartons, manualCount, ocrCount, hasMixedUnits, productCartons } from './session';
import { roundKg } from './units';

type XLSXModule = typeof XLSXType;

function readableRaw(raw: string): string {
  return raw.replace(/\x1d/g, '{GS}');
}

/** Sortable local timestamp (YYYY-MM-DD HH:mm:ss) — lexical sort == time sort. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Export subtotals sum the ROUNDED per-carton values (the same numbers written
 * to the carton rows), so a spreadsheet SUM() over the kg column matches the
 * subtotal rows exactly — no mg-level drift from rounding raw values twice.
 */
function sumRoundedKg(cartons: CartonRecord[]): number {
  return roundKg(cartons.reduce((sum, c) => sum + roundKg(c.weightKg), 0));
}

const CARTON_HEADERS = [
  'Scan time', 'Scanned by', 'Entry', 'PO Reference', 'Supplier', 'Brand', 'Product',
  'Pallet', 'Pallet ID', 'GTIN', 'Net weight', 'Unit', 'Weight (kg)', 'Batch/Lot', 'Serial',
  'Production date', 'Packaging date', 'Best before', 'Use by', 'Raw GS1 string',
];
const NCOLS = CARTON_HEADERS.length; // 20
const COL = { product: 6, weightKg: 12 } as const;

type Row = (string | number)[];

/** Export label for how a carton's weight was captured. */
const ENTRY_LABEL: Record<Pallet['cartons'][number]['entry'], string> = {
  scan: 'Scanned',
  ocr: 'OCR',
  manual: 'Manual',
};

function cartonRow(
  c: Pallet['cartons'][number],
  session: Session,
  palletNumber: number,
  palletId: string,
): Row {
  return [
    formatDateTime(c.scanTime),
    c.scannedBy,
    ENTRY_LABEL[c.entry],
    c.poRef,
    c.supplier,
    c.brand ?? session.brand ?? '',
    c.product,
    palletNumber,
    palletId,
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

const emptyRow = (): Row => new Array(NCOLS).fill('');

function subtotalRow(label: string, count: number, kg: number): Row {
  const row = emptyRow();
  row[0] = label;
  row[COL.product] = `${count} carton${count === 1 ? '' : 's'}`;
  row[COL.weightKg] = kg;
  return row;
}

function buildCartonsSheet(XLSX: XLSXModule, session: Session): XLSXType.WorkSheet {
  const aoa: Row[] = [CARTON_HEADERS];
  const merges: XLSXType.Range[] = [];
  let r = 1;
  const banner = (text: string) => {
    aoa.push([text]);
    merges.push({ s: { r, c: 0 }, e: { r, c: NCOLS - 1 } });
    r++;
  };
  const push = (row: Row) => {
    aoa.push(row);
    r++;
  };

  for (const product of session.products) {
    const noBarcode = product.startedManually && !product.gtin;
    banner(
      `PRODUCT: ${product.product}    |    Supplier: ${session.supplier}${
        session.brand ? `    |    Brand: ${session.brand}` : ''
      }${noBarcode ? `    |    STARTED MANUALLY — NO BARCODE${product.cartonId ? ` (carton ${product.cartonId})` : ''}` : ''}`,
    );

    for (const pallet of product.pallets) {
      banner(`    PALLET ${pallet.number}${pallet.palletId ? `    (ID: ${pallet.palletId})` : ''}`);
      for (const c of pallet.cartons) push(cartonRow(c, session, pallet.number, pallet.palletId ?? ''));
      push(subtotalRow(`    Pallet ${pallet.number} subtotal`, pallet.cartons.length, sumRoundedKg(pallet.cartons)));
      push(emptyRow());
    }

    const prodCartons = productCartons(product);
    push(subtotalRow(`PRODUCT SUBTOTAL — ${product.product}`, prodCartons.length, sumRoundedKg(prodCartons)));
    push(emptyRow());
  }

  const all = allCartons(session);
  push(subtotalRow('PO TOTAL', all.length, sumRoundedKg(all)));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 20 }, { wch: 14 }, { wch: 9 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 18 },
    { wch: 7 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 6 }, { wch: 11 }, { wch: 16 },
    { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 40 },
  ];
  return ws;
}

function buildSummarySheet(XLSX: XLSXModule, session: Session): XLSXType.WorkSheet {
  const all = allCartons(session);
  const aoa: Row[] = [
    ['PO Reference', session.poRef],
    ['Date/time', formatDateTime(session.startedAt)],
    ['Scanned by', session.scannedBy],
    ['Supplier', session.supplier],
    ['Brand', session.brand ?? ''],
    [],
    ['Product / Pallet', 'Cartons', 'Weight (kg)', 'Pallet ID'],
  ];
  for (const product of session.products) {
    const prodCartons = productCartons(product);
    const label =
      product.startedManually && !product.gtin ? `${product.product} (no barcode)` : product.product;
    aoa.push([label, prodCartons.length, sumRoundedKg(prodCartons), '']);
    for (const pallet of product.pallets as SessionProduct['pallets']) {
      aoa.push([`    Pallet ${pallet.number}`, pallet.cartons.length, sumRoundedKg(pallet.cartons), pallet.palletId ?? '']);
    }
  }
  aoa.push([]);
  aoa.push(['PO TOTAL', all.length, sumRoundedKg(all)]);
  aoa.push(['Products', session.products.length]);
  aoa.push(['Pallets', session.products.reduce((n, p) => n + p.pallets.length, 0)]);
  aoa.push(['Manual cartons', manualCount(all)]);
  aoa.push(['OCR cartons', ocrCount(all)]);
  aoa.push(['Mixed units', hasMixedUnits(all) ? 'Yes (kg + lb)' : 'No']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
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
