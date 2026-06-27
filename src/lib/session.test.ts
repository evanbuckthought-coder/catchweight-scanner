import { describe, it, expect } from 'vitest';
import { findDuplicate, hasMixedUnits, manualCount, totalKg } from './session';
import type { CartonRecord } from '../types';

function carton(over: Partial<CartonRecord>): CartonRecord {
  return {
    id: Math.random().toString(36).slice(2),
    scanTime: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    receiptRef: 'R1',
    supplier: 'S',
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

describe('session totals', () => {
  it('sums normalised kg', () => {
    expect(totalKg([carton({ weightKg: 7.05 }), carton({ weightKg: 13.24 })])).toBeCloseTo(20.29, 3);
  });

  it('flags mixed kg + lb', () => {
    expect(hasMixedUnits([carton({ unit: 'kg' }), carton({ unit: 'lb' })])).toBe(true);
    expect(hasMixedUnits([carton({ unit: 'kg' }), carton({ unit: 'kg' })])).toBe(false);
  });

  it('counts manual entries', () => {
    expect(manualCount([carton({ manual: true }), carton({ manual: false }), carton({ manual: true })])).toBe(2);
    expect(manualCount([carton({})])).toBe(0);
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
