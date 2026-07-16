// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
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
