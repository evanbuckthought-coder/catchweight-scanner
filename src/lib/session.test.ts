import { describe, it, expect } from 'vitest';
import {
  allCartons,
  findDuplicate,
  hasMixedUnits,
  manualCount,
  ocrCount,
  palletSubtotal,
  poTotals,
  productCartons,
  productSubtotal,
  totalKg,
} from './session';
import type { CartonRecord, Pallet, Session, SessionProduct } from '../types';

function carton(over: Partial<CartonRecord>): CartonRecord {
  return {
    id: Math.random().toString(36).slice(2),
    scanTime: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    poRef: 'PO1',
    supplier: 'Sup',
    product: 'P',
    gtin: '00000000000000',
    netWeight: 10,
    unit: 'kg',
    weightKg: 10,
    raw: '',
    fingerprint: 'fp',
    entry: 'scan',
    ...over,
  };
}

function pallet(id: string, cartons: CartonRecord[], palletId?: string): Pallet {
  return { id, number: 1, palletId, startedAt: '2026-06-22T09:00:00.000Z', cartons };
}

function product(id: string, pallets: Pallet[]): SessionProduct {
  return { id, product: `Product ${id}`, gtin: '0', fingerprint: 'fp', startedAt: '2026-06-22T09:00:00.000Z', pallets };
}

function session(products: SessionProduct[]): Session {
  return {
    id: 's',
    poRef: 'PO1',
    supplier: 'Sup',
    startedAt: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    products,
    activeProductId: null,
    activePalletId: null,
  };
}

describe('carton totals', () => {
  it('sums normalised kg', () => {
    expect(totalKg([carton({ weightKg: 7.05 }), carton({ weightKg: 13.24 })])).toBeCloseTo(20.29, 3);
  });
  it('flags mixed kg + lb', () => {
    expect(hasMixedUnits([carton({ unit: 'kg' }), carton({ unit: 'lb' })])).toBe(true);
  });
  it('counts manual and OCR entries by capture method', () => {
    const mix = [carton({ entry: 'manual' }), carton({}), carton({ entry: 'ocr' }), carton({ entry: 'manual' })];
    expect(manualCount(mix)).toBe(2);
    expect(ocrCount(mix)).toBe(1);
  });
});

describe('pallet + product + PO aggregation', () => {
  const s = session([
    product('a', [
      pallet('a1', [carton({ weightKg: 7.05 }), carton({ weightKg: 13.24 })]),
      pallet('a2', [carton({ weightKg: 10 })]),
    ]),
    product('b', [pallet('b1', [carton({ weightKg: 21.13, unit: 'lb', entry: 'manual' })])]),
  ]);

  it('per-pallet subtotal', () => {
    expect(palletSubtotal(s.products[0].pallets[0])).toEqual({ count: 2, kg: 20.29 });
    expect(palletSubtotal(s.products[0].pallets[1])).toEqual({ count: 1, kg: 10 });
  });
  it('product cartons span its pallets', () => {
    expect(productCartons(s.products[0])).toHaveLength(3);
    expect(productSubtotal(s.products[0])).toEqual({ count: 3, kg: 30.29 });
  });
  it('flattens all cartons across products + pallets', () => {
    expect(allCartons(s)).toHaveLength(4);
  });
  it('PO totals incl. products, pallets, manual, mixed units', () => {
    const t = poTotals(s);
    expect(t.productCount).toBe(2);
    expect(t.palletCount).toBe(3);
    expect(t.cartonCount).toBe(4);
    expect(t.kg).toBeCloseTo(51.42, 2);
    expect(t.manual).toBe(1);
    expect(t.mixedUnits).toBe(true);
  });
});

describe('dedupe', () => {
  const serialCarton = carton({ gtin: 'G1', serial: 'S1', raw: '(01)G1(3102)002113(21)S1' });
  const batchA = carton({ gtin: 'G2', batch: 'B1', raw: '(01)G2(3102)000705(10)B1' });
  const batchB = carton({ gtin: 'G2', batch: 'B1', raw: '(01)G2(3102)000712(10)B1' });
  const manualCarton = carton({ gtin: 'G2', batch: 'B1', raw: '', entry: 'manual' });
  const cartons = [serialCarton, batchA, batchB, manualCarton];

  it('hard-dedupes on gtin + serial', () => {
    expect(findDuplicate(cartons, { gtin: 'G1', serial: 'S1', raw: 'anything' })).toBe(serialCarton);
  });
  it('a different serial on the same gtin is not a duplicate', () => {
    expect(findDuplicate(cartons, { gtin: 'G1', serial: 'S9', raw: 'x' })).toBeUndefined();
  });
  it('batch-only: a second carton of the SAME batch with a different weight is NOT a duplicate', () => {
    // This is the critical case: batches are shared across cartons.
    expect(
      findDuplicate([batchA], { gtin: 'G2', serial: undefined, raw: '(01)G2(3102)000712(10)B1' }),
    ).toBeUndefined();
  });
  it('batch-only: an identical full raw string (true re-scan) IS a duplicate', () => {
    expect(
      findDuplicate(cartons, { gtin: 'G2', serial: undefined, raw: '(01)G2(3102)000705(10)B1' }),
    ).toBe(batchA);
  });
  it('manual/OCR cartons (empty raw) never match raw-dedupe', () => {
    expect(findDuplicate([manualCarton], { gtin: 'G2', serial: undefined, raw: '' })).toBeUndefined();
  });
});
