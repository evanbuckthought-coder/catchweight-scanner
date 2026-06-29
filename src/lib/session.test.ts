import { describe, it, expect } from 'vitest';
import {
  allCartons,
  findDuplicate,
  hasMixedUnits,
  manualCount,
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
    manual: false,
    ...over,
  };
}

function pallet(id: string, cartons: CartonRecord[], palletId?: string): Pallet {
  return { id, palletId, startedAt: '2026-06-22T09:00:00.000Z', cartons };
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
  it('counts manual entries', () => {
    expect(manualCount([carton({ manual: true }), carton({}), carton({ manual: true })])).toBe(2);
  });
});

describe('pallet + product + PO aggregation', () => {
  const s = session([
    product('a', [
      pallet('a1', [carton({ weightKg: 7.05 }), carton({ weightKg: 13.24 })]),
      pallet('a2', [carton({ weightKg: 10 })]),
    ]),
    product('b', [pallet('b1', [carton({ weightKg: 21.13, unit: 'lb', manual: true })])]),
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
