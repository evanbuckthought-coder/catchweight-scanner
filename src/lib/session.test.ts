import { describe, it, expect } from 'vitest';
import { allCartons, findDuplicate, hasMixedUnits, manualCount, poTotals, productSubtotal, totalKg } from './session';
import type { CartonRecord, Session, SessionProduct } from '../types';

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
    manual: false,
    ...over,
  };
}

function product(id: string, cartons: CartonRecord[], over: Partial<SessionProduct> = {}): SessionProduct {
  return {
    id,
    product: `Product ${id}`,
    gtin: '00000000000000',
    fingerprint: 'fp',
    startedAt: '2026-06-22T09:00:00.000Z',
    cartons,
    ...over,
  };
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
  };
}

describe('carton totals', () => {
  it('sums normalised kg', () => {
    expect(totalKg([carton({ weightKg: 7.05 }), carton({ weightKg: 13.24 })])).toBeCloseTo(20.29, 3);
  });
  it('flags mixed kg + lb', () => {
    expect(hasMixedUnits([carton({ unit: 'kg' }), carton({ unit: 'lb' })])).toBe(true);
    expect(hasMixedUnits([carton({ unit: 'kg' }), carton({ unit: 'kg' })])).toBe(false);
  });
  it('counts manual entries', () => {
    expect(manualCount([carton({ manual: true }), carton({}), carton({ manual: true })])).toBe(2);
  });
});

describe('product + PO aggregation', () => {
  const s = session([
    product('a', [carton({ weightKg: 7.05 }), carton({ weightKg: 13.24 })]),
    product('b', [carton({ weightKg: 21.13, unit: 'lb', manual: true })]),
  ]);

  it('flattens all cartons across products', () => {
    expect(allCartons(s)).toHaveLength(3);
  });
  it('per-product subtotal', () => {
    expect(productSubtotal(s.products[0])).toEqual({ count: 2, kg: 20.29 });
    expect(productSubtotal(s.products[1])).toEqual({ count: 1, kg: 21.13 });
  });
  it('PO totals incl. products, manual, mixed units', () => {
    const t = poTotals(s);
    expect(t.productCount).toBe(2);
    expect(t.cartonCount).toBe(3);
    expect(t.kg).toBeCloseTo(41.42, 2);
    expect(t.manual).toBe(1);
    expect(t.mixedUnits).toBe(true);
  });
});

describe('dedupe', () => {
  const cartons = [carton({ gtin: 'G1', traceId: 'T1' }), carton({ gtin: 'G2', traceId: 'T2' })];
  it('finds an exact gtin+trace re-scan', () => {
    expect(findDuplicate(cartons, 'G1', 'T1')).toBeDefined();
  });
  it('different trace id is not a duplicate', () => {
    expect(findDuplicate(cartons, 'G1', 'T9')).toBeUndefined();
  });
  it('no trace id never dedupes', () => {
    expect(findDuplicate(cartons, 'G1', undefined)).toBeUndefined();
  });
});
