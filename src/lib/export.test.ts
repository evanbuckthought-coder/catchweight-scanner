import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbook } from './export';
import { parseGS1 } from './gs1';
import { toCartonRecord, toManualCartonRecord } from './carton';
import { SAMPLE_LABELS } from './testData';
import { suggestSupplier } from './suppliers';
import type { Session } from '../types';

/** Five scanned sample labels (Smithfield is lb -> mixed units) + one manual entry. */
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
  // One hand-keyed carton (unreadable barcode), in lb to exercise conversion.
  cartons.push(
    toManualCartonRecord(
      { netWeight: 10, unit: 'lb', product: 'Mince (manual)', supplier: 'Smithfield (US)' },
      { scannedBy: 'Evan B', receiptRef: 'GR-2026-0042' },
    ),
  );
  return {
    id: 'sess-1',
    receiptRef: 'GR-2026-0042',
    startedAt: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    cartons,
  };
}

describe('Excel export', () => {
  it('produces a two-sheet workbook with the right tabs', async () => {
    const wb = await buildWorkbook(sampleSession());
    expect(wb.SheetNames).toEqual(['Cartons', 'Receipt summary']);
  });

  it('Cartons sheet has one row per carton, an Entry column, and the audit columns', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Cartons']);
    expect(rows).toHaveLength(6); // 5 scanned + 1 manual

    const headers = Object.keys(rows[0]);
    for (const col of [
      'Scan time', 'Scanned by', 'Entry', 'Receipt/PO ref', 'Supplier', 'Product', 'GTIN',
      'Net weight', 'Unit', 'Weight (kg)', 'Batch/Lot', 'Serial', 'Production date',
      'Packaging date', 'Best before', 'Use by', 'Raw GS1 string',
    ]) {
      expect(headers, `missing column "${col}"`).toContain(col);
    }

    // Scanned Smithfield row: pounds normalised to kg, serial trace, packaging date.
    const smithfield = rows.find((r) => r.GTIN === '90070247165421')!;
    expect(smithfield.Entry).toBe('Scanned');
    expect(smithfield.Unit).toBe('lb');
    expect(smithfield['Weight (kg)']).toBeCloseTo(21.65 * 0.45359237, 2);

    // Manual row: flagged 'Manual', lb converted to kg.
    const manual = rows.find((r) => r.Product === 'Mince (manual)')!;
    expect(manual.Entry).toBe('Manual');
    expect(manual.Unit).toBe('lb');
    expect(manual['Weight (kg)']).toBeCloseTo(10 * 0.45359237, 2);
  });

  it('Receipt summary has counts + total kg, manual count, and mixed-units flag (no variance)', async () => {
    const wb = await buildWorkbook(sampleSession());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Receipt summary']);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r['Receipt/PO ref']).toBe('GR-2026-0042');
    expect(r['Carton count']).toBe(6);
    // 5 sample labels (64.86 kg) + manual 10 lb (4.54 kg) ~= 69.40 kg.
    expect(r['Total kg']).toBeCloseTo(64.86 + 10 * 0.45359237, 2);
    expect(r['Manual cartons']).toBe(1);
    expect(String(r['Mixed units'])).toContain('Yes');
    // No variance/status columns anymore.
    expect(r).not.toHaveProperty('Variance kg');
    expect(r).not.toHaveProperty('Status');
    expect(r).not.toHaveProperty('Expected kg');
  });
});
