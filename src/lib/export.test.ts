import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbook } from './export';
import { parseGS1 } from './gs1';
import { toCartonRecord, toManualCartonRecord } from './carton';
import type { Session, SessionProduct } from '../types';

const LB_TO_KG = 0.45359237;

function scanned(code: string, product: string) {
  return toCartonRecord(parseGS1(code), {
    scannedBy: 'Evan B',
    poRef: 'PO-2026-0042',
    supplier: 'Teys Australia',
    brand: 'Teys Beef',
    product,
  });
}

function prod(id: string, product: string, cartons: SessionProduct['cartons']): SessionProduct {
  return { id, product, gtin: cartons[0]?.gtin ?? '', fingerprint: '', startedAt: '2026-06-22T09:00:00.000Z', cartons };
}

/** Two products under one PO; product B mixes a scanned lb + a manual lb carton. */
function sampleSession(): Session {
  const beef = prod('a', 'Beef brisket', [
    scanned('(01)99332218021206(3102)002113(13)251211(21)050073950220', 'Beef brisket'),
    scanned('(01)99418220351538(3102)001362(11)251008(21)365281020745', 'Beef brisket'),
  ]);
  const pork = prod('b', 'Pork loin', [
    scanned('(01)90070247165421(3202)002165(13)260310(21)116069056422', 'Pork loin'),
    toManualCartonRecord(
      { netWeight: 10, unit: 'lb', batch: 'B-123' },
      {
        scannedBy: 'Evan B',
        poRef: 'PO-2026-0042',
        supplier: 'Teys Australia',
        brand: 'Teys Beef',
        product: 'Pork loin',
        gtin: '90070247165421',
      },
    ),
  ]);
  return {
    id: 'sess-1',
    poRef: 'PO-2026-0042',
    supplier: 'Teys Australia',
    brand: 'Teys Beef',
    startedAt: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    products: [beef, pork],
    activeProductId: null,
  };
}

function rowsOf(ws: XLSX.WorkSheet): (string | number)[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
}

describe('Excel export — grouped by product', () => {
  it('has Cartons + Summary sheets', async () => {
    const wb = await buildWorkbook(sampleSession());
    expect(wb.SheetNames).toEqual(['Cartons', 'Summary']);
  });

  it('Cartons sheet keeps the per-carton columns (PO, brand, manual flag, raw, etc.)', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = rowsOf(wb.Sheets['Cartons']);
    const header = rows[0].map(String);
    for (const col of [
      'Scan time', 'Scanned by', 'Entry', 'PO Reference', 'Supplier', 'Brand', 'Product', 'GTIN',
      'Net weight', 'Unit', 'Weight (kg)', 'Batch/Lot', 'Serial', 'Production date',
      'Packaging date', 'Best before', 'Use by', 'Raw GS1 string',
    ]) {
      expect(header, `missing column "${col}"`).toContain(col);
    }
  });

  it('groups by product with banner, subtotal, and an overall PO total', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = rowsOf(wb.Sheets['Cartons']);
    const colA = rows.map((r) => String(r[0] ?? ''));

    const banners = colA.filter((v) => v.startsWith('PRODUCT:'));
    expect(banners).toHaveLength(2);
    expect(banners[0]).toContain('Beef brisket');
    expect(banners[0]).toContain('Teys Australia');
    expect(banners[0]).toContain('Teys Beef'); // brand in the banner

    const subtotals = colA.filter((v) => v.startsWith('SUBTOTAL'));
    expect(subtotals).toHaveLength(2);

    const totalRowIdx = colA.findIndex((v) => v === 'PO TOTAL');
    expect(totalRowIdx).toBeGreaterThan(0);
    const totalRow = rows[totalRowIdx];
    // overall kg = beef (21.13 + 13.62) + pork (21.65lb + 10lb -> kg)
    const expectedKg = 21.13 + 13.62 + (21.65 + 10) * LB_TO_KG;
    expect(Number(totalRow[10])).toBeCloseTo(Math.round(expectedKg * 1000) / 1000, 2);

    // merged banner ranges exist
    expect((wb.Sheets['Cartons']['!merges'] ?? []).length).toBe(2);
  });

  it('flags the manual carton and converts lb -> kg', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = rowsOf(wb.Sheets['Cartons']);
    const manual = rows.find((r) => String(r[2]) === 'Manual')!;
    expect(manual).toBeTruthy();
    expect(manual[6]).toBe('Pork loin'); // inherited product
    expect(manual[9]).toBe('lb');
    expect(Number(manual[10])).toBeCloseTo(10 * LB_TO_KG, 2);
    expect(manual[11]).toBe('B-123'); // batch preserved
  });

  it('contains none of the removed expected/variance/status fields', async () => {
    const wb = await buildWorkbook(sampleSession());
    const dump = JSON.stringify(rowsOf(wb.Sheets['Cartons'])) + JSON.stringify(rowsOf(wb.Sheets['Summary']));
    for (const banned of ['Expected', 'Variance', 'Tolerance', 'Status', 'HOLD']) {
      expect(dump, `"${banned}" should not appear`).not.toContain(banned);
    }
  });

  it('Summary sheet lists each product + PO totals', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = rowsOf(wb.Sheets['Summary']).map((r) => r.map(String));
    const flat = rows.map((r) => r.join('|'));
    expect(flat.some((l) => l.startsWith('PO Reference|PO-2026-0042'))).toBe(true);
    expect(flat.some((l) => l.startsWith('Beef brisket|'))).toBe(true);
    expect(flat.some((l) => l.startsWith('Pork loin|'))).toBe(true);
    expect(flat.some((l) => l.startsWith('PO TOTAL|'))).toBe(true);
    expect(flat.some((l) => l.startsWith('Mixed units|Yes'))).toBe(true);
  });
});
