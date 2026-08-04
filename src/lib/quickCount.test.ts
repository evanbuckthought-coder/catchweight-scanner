// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  findQuickDuplicate,
  loadSavedQuickCounts,
  quickCountTotalKg,
  removeSavedQuickCount,
  saveQuickCount,
  type QuickCountEntry,
} from './quickCount';

const entry = (weightKg: number, over: Partial<QuickCountEntry> = {}): QuickCountEntry => ({
  id: `id-${weightKg}-${Math.round(weightKg * 1000)}`,
  netWeight: weightKg,
  unit: 'kg',
  weightKg,
  entry: 'manual',
  time: '2026-07-06T00:00:00.000Z',
  ...over,
});

beforeEach(() => localStorage.clear());

describe('quickCountTotalKg', () => {
  it('sums rounded per-entry kg (matches the export)', () => {
    expect(quickCountTotalKg([entry(14.54), entry(15.021), entry(8.2)])).toBeCloseTo(37.761, 3);
  });

  it('is zero for an empty count', () => {
    expect(quickCountTotalKg([])).toBe(0);
  });

  it('sums lb entries by their converted kg', () => {
    // 32.06 lb -> 14.54 kg (already stored in weightKg by the caller)
    expect(quickCountTotalKg([entry(14.54, { unit: 'lb', netWeight: 32.06 })])).toBeCloseTo(14.54, 2);
  });
});

describe('findQuickDuplicate — same-carton flag (mirrors the receival rules)', () => {
  const rawA = '(01)94015433211209(3102)002246(21)0012843';
  const scanned = entry(22.46, { entry: 'scan', gtin: '94015433211209', serial: '0012843', raw: rawA });

  it('flags a re-scan by GTIN + serial', () => {
    expect(
      findQuickDuplicate([scanned], { gtin: '94015433211209', serial: '0012843', raw: 'different-read' }),
    ).toBe(scanned);
  });

  it('a different serial on the same product is NOT a duplicate', () => {
    expect(
      findQuickDuplicate([scanned], { gtin: '94015433211209', serial: '0099999', raw: '(01)94015433211209(3102)002313(21)0099999' }),
    ).toBeUndefined();
  });

  it('flags an identical full barcode when there is no serial', () => {
    const noSerialRaw = '(01)94015433211209(3102)002246(10)P0447';
    const e = entry(22.46, { entry: 'scan', gtin: '94015433211209', raw: noSerialRaw });
    expect(findQuickDuplicate([e], { gtin: '94015433211209', raw: noSerialRaw })).toBe(e);
  });

  it('same product, different weight is NOT a duplicate (raw differs)', () => {
    const e = entry(22.46, { entry: 'scan', gtin: '94015433211209', raw: '(01)94015433211209(3102)002246(10)P0447' });
    expect(
      findQuickDuplicate([e], { gtin: '94015433211209', raw: '(01)94015433211209(3102)002375(10)P0447' }),
    ).toBeUndefined();
  });

  it('manual entries and first-release entries (no raw) never match', () => {
    expect(findQuickDuplicate([entry(22.46)], { gtin: '94015433211209', raw: rawA })).toBeUndefined();
  });
});

describe('saved quick counts (separate from receival History)', () => {
  it('saves newest-first with a derived count + total', () => {
    saveQuickCount([entry(10), entry(20)], 'Evan');
    saveQuickCount([entry(5)], 'Evan');
    const all = loadSavedQuickCounts();
    expect(all).toHaveLength(2);
    expect(all[0].count).toBe(1); // newest first
    expect(all[1].count).toBe(2);
    expect(all[1].totalKg).toBe(30);
    expect(all[1].scannedBy).toBe('Evan');
  });

  it('uses its own storage key, untouched by receivals', () => {
    saveQuickCount([entry(10)], 'Evan');
    expect(localStorage.getItem('cw.quickCounts')).toBeTruthy();
    // no receival keys written
    expect(localStorage.getItem('cw.currentSession')).toBeNull();
  });

  it('removes a saved count by id', () => {
    const a = saveQuickCount([entry(10)], 'Evan');
    saveQuickCount([entry(20)], 'Evan');
    const rest = removeSavedQuickCount(a.id);
    expect(rest).toHaveLength(1);
    expect(rest.find((q) => q.id === a.id)).toBeUndefined();
  });
});
