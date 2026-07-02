import { describe, it, expect } from 'vitest';
import { migrateSession, CURRENT_SCHEMA } from './persistence';
import { allCartons, totalKg } from './session';
import type { Session } from '../types';

const baseCarton = {
  id: 'c1',
  scanTime: '2026-06-22T09:00:00.000Z',
  scannedBy: 'Evan B',
  poRef: 'PO1',
  supplier: 'Sup',
  product: 'Beef',
  gtin: '99332218021206',
  netWeight: 21.13,
  unit: 'kg',
  weightKg: 21.13,
  raw: '(01)...',
  fingerprint: 'fp',
};

/** v2 shape: PO -> products -> cartons, manual boolean. */
function v2Session() {
  return {
    id: 's2',
    poRef: 'PO1',
    supplier: 'Sup',
    brand: 'Br',
    startedAt: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    products: [
      {
        id: 'p1',
        product: 'Beef',
        gtin: '99332218021206',
        fingerprint: 'fp',
        startedAt: '2026-06-22T09:00:00.000Z',
        cartons: [
          { ...baseCarton, manual: false },
          { ...baseCarton, id: 'c2', weightKg: 10, netWeight: 10, manual: true },
        ],
      },
    ],
    activeProductId: null,
  };
}

/** v4 shape: pallets without numbers, cartons with entry. */
function v4Session() {
  return {
    id: 's4',
    poRef: 'PO4',
    supplier: 'Sup',
    startedAt: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    products: [
      {
        id: 'p1',
        product: 'Beef',
        gtin: '99332218021206',
        fingerprint: 'fp',
        startedAt: '2026-06-22T09:00:00.000Z',
        pallets: [
          { id: 'pl1', startedAt: '2026-06-22T09:00:00.000Z', cartons: [{ ...baseCarton, entry: 'scan' }] },
          { id: 'pl2', startedAt: '2026-06-22T09:05:00.000Z', cartons: [{ ...baseCarton, id: 'c2', entry: 'ocr' }] },
        ],
      },
    ],
    activeProductId: null,
    activePalletId: null,
  };
}

describe('schema migrations', () => {
  it('migrates v2 (flat products) to current: wraps cartons in pallet 1, maps manual->entry', () => {
    const s = migrateSession(v2Session(), 2) as Session;
    expect(s).not.toBeNull();
    expect(s.products[0].pallets).toHaveLength(1);
    expect(s.products[0].pallets[0].number).toBe(1);
    const cartons = allCartons(s);
    expect(cartons).toHaveLength(2);
    expect(cartons[0].entry).toBe('scan');
    expect(cartons[1].entry).toBe('manual');
    // weights survive untouched
    expect(totalKg(cartons)).toBeCloseTo(31.13, 2);
  });

  it('migrates v4 to current: assigns pallet numbers positionally, keeps entries', () => {
    const s = migrateSession(v4Session(), 4) as Session;
    expect(s).not.toBeNull();
    expect(s.products[0].pallets.map((p) => p.number)).toEqual([1, 2]);
    expect(allCartons(s).map((c) => c.entry)).toEqual(['scan', 'ocr']);
  });

  it('v5 passes through migrations untouched when asked from v5', () => {
    const v5 = migrateSession(v4Session(), 4) as Session;
    const again = migrateSession(v5, CURRENT_SCHEMA);
    expect(again).toEqual(v5);
  });

  it('returns null (preserve, never guess) for newer or unknown versions', () => {
    expect(migrateSession(v4Session(), CURRENT_SCHEMA + 1)).toBeNull();
    expect(migrateSession(v4Session(), 0)).toBeNull(); // v1/unknown: no path
  });

  it('returns null for corrupt data instead of throwing', () => {
    expect(migrateSession(null, 4)).toBeNull();
    expect(migrateSession('garbage', 4)).toBeNull();
    expect(migrateSession({ nothing: true }, 4)).toBeNull();
  });
});
