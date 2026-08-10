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

  it('the real Teys brisket label is caught on a re-scan, in any scanner form', () => {
    // (01)99332218351761(3102)001754(13)260630(21)090000400447 -> 17.54 kg.
    const first = entry(17.54, {
      entry: 'scan',
      gtin: '99332218351761',
      serial: '090000400447',
      raw: '01993322183517613102001754132606302109000040044 7'.replace(' ', ''),
    });
    // A second read of the SAME carton often differs byte-for-byte (GS
    // separators, symbology prefix), so the serial is what must catch it.
    for (const raw of [
      '(01)99332218351761(3102)001754(13)260630(21)090000400447',
      ']C1019933221835176131020017541326063021090000400447',
      '019933221835176131020017541326063021090000400447\x1d',
    ]) {
      expect(findQuickDuplicate([first], { gtin: '99332218351761', serial: '090000400447', raw })).toBe(first);
    }
  });

  it('a DIFFERENT carton of the same product at the same weight still counts', () => {
    // Two 17.54 kg cartons on one pallet is ordinary — only the serial differs.
    const first = entry(17.54, { entry: 'scan', gtin: '99332218351761', serial: '090000400447', raw: 'a' });
    expect(
      findQuickDuplicate([first], { gtin: '99332218351761', serial: '090000400448', raw: 'b' }),
    ).toBeUndefined();
  });

  it('KNOWN GAP: an entry recorded before carton IDs were stored cannot be matched', () => {
    // Counts started before the re-scan flag shipped hold no gtin/serial/raw,
    // so a later scan of that same carton has nothing to match against and
    // counts again. The row now says "no carton ID recorded" so the operator
    // can see which entries are unverifiable rather than being misled.
    const legacy = entry(17.54, { entry: 'scan' });
    expect(
      findQuickDuplicate([legacy], { gtin: '99332218351761', serial: '090000400447', raw: 'x' }),
    ).toBeUndefined();
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
