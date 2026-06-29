import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbook } from './export';
import { parseGS1 } from './gs1';
import { toCartonRecord, toManualCartonRecord } from './carton';
import type { Pallet, Session, SessionProduct } from '../types';

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

function pallet(id: string, cartons: Pallet['cartons'], palletId?: string): Pallet {
  return { id, palletId, startedAt: '2026-06-22T09:00:00.000Z', cartons };
}
function product(id: string, name: string, pallets: Pallet[]): SessionProduct {
  return { id, product: name, gtin: pallets[0]?.cartons[0]?.gtin ?? '', fingerprint: '', startedAt: '2026-06-22T09:00:00.000Z', pallets };
}

/** 2 products; beef has 2 pallets (one with an id), pork has a scanned + manual lb. */
function sampleSession(): Session {
  const beef = product('a', 'Beef brisket', [
    pallet('a1', [
      scanned('(01)99332218021206(3102)002113(13)251211(21)050073950220', 'Beef brisket'),
      scanned('(01)99418220351538(3102)001362(11)251008(21)365281020745', 'Beef brisket'),
    ], 'SSCC-001'),
    pallet('a2', [scanned('(01)99420023200173(3102)001324(11)260202(10)6034080028', 'Beef brisket')]),
  ]);
  const pork = product('b', 'Pork loin', [
    pallet('b1', [
      scanned('(01)90070247165421(3202)002165(13)260310(21)116069056422', 'Pork loin'),
      toManualCartonRecord(
        { netWeight: 10, unit: 'lb', batch: 'B-123' },
        { scannedBy: 'Evan B', poRef: 'PO-2026-0042', supplier: 'Teys Australia', brand: 'Teys Beef', product: 'Pork loin', gtin: '90070247165421' },
      ),
    ]),
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
    activePalletId: null,
  };
}

function rowsOf(ws: XLSX.WorkSheet): (string | number)[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
}

describe('Excel export — grouped by product then pallet', () => {
  it('has Cartons + Summary sheets', async () => {
    const wb = await buildWorkbook(sampleSession());
    expect(wb.SheetNames).toEqual(['Cartons', 'Summary']);
  });

  it('Cartons header has Pallet + Pallet ID columns alongside the rest', async () => {
    const wb = await buildWorkbook(sampleSession());
    const header = rowsOf(wb.Sheets['Cartons'])[0].map(String);
    for (const col of [
      'Scan time', 'Scanned by', 'Entry', 'PO Reference', 'Supplier', 'Brand', 'Product',
      'Pallet', 'Pallet ID', 'GTIN', 'Net weight', 'Unit', 'Weight (kg)', 'Batch/Lot', 'Serial',
      'Production date', 'Packaging date', 'Best before', 'Use by', 'Raw GS1 string',
    ]) {
      expect(header, `missing column "${col}"`).toContain(col);
    }
  });

  it('nests pallets under products with banners, subtotals, and a PO total', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = rowsOf(wb.Sheets['Cartons']);
    const colA = rows.map((r) => String(r[0] ?? '').trim());

    expect(colA.filter((v) => v.startsWith('PRODUCT:'))).toHaveLength(2);
    expect(colA.filter((v) => v.startsWith('PALLET '))).toHaveLength(3); // 2 + 1 pallets
    expect(colA.filter((v) => v.startsWith('PRODUCT SUBTOTAL'))).toHaveLength(2);
    expect(colA.filter((v) => /^Pallet \d+ subtotal/.test(v))).toHaveLength(3);

    // first pallet banner carries the pallet id
    expect(colA.find((v) => v.startsWith('PALLET 1'))).toContain('SSCC-001');

    const totalIdx = colA.indexOf('PO TOTAL');
    expect(totalIdx).toBeGreaterThan(0);
    const expectedKg = 21.13 + 13.62 + 13.24 + (21.65 + 10) * LB_TO_KG;
    expect(Number(rows[totalIdx][12])).toBeCloseTo(Math.round(expectedKg * 1000) / 1000, 2);

    // 2 product banners + 3 pallet banners merged
    expect((wb.Sheets['Cartons']['!merges'] ?? []).length).toBe(5);
  });

  it('carton rows carry the pallet number and pallet id', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = rowsOf(wb.Sheets['Cartons']);
    const cartonRows = rows.filter((r) => r[2] === 'Scanned' || r[2] === 'Manual');
    // Beef pallet 1 has an id; beef pallet 2 has none. (Pallet numbers reset per product.)
    const beefP1 = cartonRows.filter((r) => r[6] === 'Beef brisket' && r[7] === 1);
    const beefP2 = cartonRows.filter((r) => r[6] === 'Beef brisket' && r[7] === 2);
    expect(beefP1).toHaveLength(2);
    expect(beefP1.every((r) => r[8] === 'SSCC-001')).toBe(true);
    expect(beefP2).toHaveLength(1);
    expect(beefP2.every((r) => r[8] === '')).toBe(true);

    const manual = cartonRows.find((r) => r[2] === 'Manual')!;
    expect(Number(manual[12])).toBeCloseTo(10 * LB_TO_KG, 2);
    expect(manual[13]).toBe('B-123');
  });

  it('contains none of the removed expected/variance/status fields', async () => {
    const wb = await buildWorkbook(sampleSession());
    const dump = JSON.stringify(rowsOf(wb.Sheets['Cartons'])) + JSON.stringify(rowsOf(wb.Sheets['Summary']));
    for (const banned of ['Expected', 'Variance', 'Tolerance', 'Status', 'HOLD']) {
      expect(dump, `"${banned}" should not appear`).not.toContain(banned);
    }
  });

  it('Summary breaks down products into pallets + PO totals', async () => {
    const wb = await buildWorkbook(sampleSession());
    const flat = rowsOf(wb.Sheets['Summary']).map((r) => r.map(String).join('|'));
    expect(flat.some((l) => l.startsWith('PO Reference|PO-2026-0042'))).toBe(true);
    expect(flat.some((l) => l.startsWith('Product / Pallet|'))).toBe(true);
    expect(flat.some((l) => l.startsWith('Beef brisket|'))).toBe(true);
    expect(flat.some((l) => l.trim().startsWith('Pallet 1|'))).toBe(true);
    expect(flat.some((l) => l.startsWith('Pallets|'))).toBe(true);
    expect(flat.some((l) => l.startsWith('Mixed units|Yes'))).toBe(true);
  });
});
