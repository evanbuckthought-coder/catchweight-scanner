import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbook } from './export';
import { parseGS1 } from './gs1';
import { toCartonRecord } from './carton';
import { SAMPLE_LABELS } from './testData';
import { suggestSupplier } from './suppliers';
import type { Session } from '../types';

/** Build a session from the five sample labels (Smithfield is lb -> mixed units). */
function sampleSession(): Session {
  const cartons = SAMPLE_LABELS.map((s) => {
    const parsed = parseGS1(s.code);
    return toCartonRecord(parsed, {
      scannedBy: 'Evan B',
      receiptRef: 'GR-2026-0042',
      product: s.product,
      supplier: suggestSupplier(parsed.gtin) ?? '',
    });
  });
  return {
    id: 'sess-1',
    receiptRef: 'GR-2026-0042',
    startedAt: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    expectation: { expectedKg: 64.86, expectedCartons: 5, toleranceKg: 0 },
    cartons,
  };
}

describe('Excel export', () => {
  it('produces a two-sheet workbook with the right tabs', async () => {
    const wb = await buildWorkbook(sampleSession());
    expect(wb.SheetNames).toEqual(['Cartons', 'Receipt summary']);
  });

  it('Cartons sheet has one row per carton with the audit columns', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Cartons']);
    expect(rows).toHaveLength(5);

    const headers = Object.keys(rows[0]);
    for (const col of [
      'Scan time', 'Scanned by', 'Receipt/PO ref', 'Supplier', 'Product', 'GTIN',
      'Net weight', 'Unit', 'Weight (kg)', 'Batch/Lot', 'Serial', 'Production date',
      'Packaging date', 'Best before', 'Use by', 'Raw GS1 string',
    ]) {
      expect(headers, `missing column "${col}"`).toContain(col);
    }

    // The Smithfield row: pounds normalised to kg, serial trace, packaging date.
    const smithfield = rows.find((r) => r.GTIN === '90070247165421')!;
    expect(smithfield.Unit).toBe('lb');
    expect(smithfield['Weight (kg)']).toBeCloseTo(21.65 * 0.45359237, 2);
    expect(smithfield.Serial).toBe('116069056422');
    expect(smithfield['Packaging date']).toBe('2026-03-10');
  });

  it('Receipt summary has the variance + HOLD/MATCH status', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Receipt summary']);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r['Receipt/PO ref']).toBe('GR-2026-0042');
    expect(r['Carton count']).toBe(5);
    expect(r['Total kg']).toBeCloseTo(64.86, 2);
    expect(r['Variance kg']).toBeCloseTo(0, 2);
    expect(r['Variance ctns']).toBe(0);
    // Within tolerance on a perfect count, but units were mixed -> flagged.
    expect(String(r.Status)).toContain('MATCH');
    expect(String(r.Status)).toContain('MIXED UNITS');
  });
});
