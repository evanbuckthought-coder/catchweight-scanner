import { describe, it, expect } from 'vitest';
import { computeVariance, findDuplicate, hasMixedUnits, statusLabel, totalKg } from './session';
import type { CartonRecord, Session } from '../types';

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
    ...over,
  };
}

function session(cartons: CartonRecord[], exp: Partial<Session['expectation']> = {}): Session {
  return {
    id: 's',
    receiptRef: 'R1',
    startedAt: '2026-06-22T09:00:00.000Z',
    scannedBy: 'Evan B',
    expectation: { toleranceKg: 0, ...exp },
    cartons,
  };
}

describe('session totals & variance', () => {
  it('sums normalised kg', () => {
    expect(totalKg([carton({ weightKg: 7.05 }), carton({ weightKg: 13.24 })])).toBeCloseTo(20.29, 3);
  });

  it('flags mixed kg + lb', () => {
    expect(hasMixedUnits([carton({ unit: 'kg' }), carton({ unit: 'lb' })])).toBe(true);
    expect(hasMixedUnits([carton({ unit: 'kg' }), carton({ unit: 'kg' })])).toBe(false);
  });

  it('match within tolerance', () => {
    const v = computeVariance(session([carton({ weightKg: 10 })], { expectedKg: 10.3, toleranceKg: 0.5, expectedCartons: 1 }));
    expect(v.status).toBe('match');
    expect(v.hold).toBe(false);
    expect(statusLabel(v)).toBe('MATCH');
  });

  it('short beyond tolerance => HOLD', () => {
    const v = computeVariance(session([carton({ weightKg: 9 })], { expectedKg: 10, toleranceKg: 0.5 }));
    expect(v.status).toBe('short');
    expect(v.hold).toBe(true);
    expect(statusLabel(v)).toBe('HOLD (SHORT)');
  });

  it('over beyond tolerance => HOLD', () => {
    const v = computeVariance(session([carton({ weightKg: 12 })], { expectedKg: 10, toleranceKg: 0.5 }));
    expect(v.status).toBe('over');
    expect(v.hold).toBe(true);
  });

  it('carton-count mismatch is always a HOLD even if kg is within tolerance', () => {
    const v = computeVariance(
      session([carton({ weightKg: 10 })], { expectedKg: 10, toleranceKg: 0.5, expectedCartons: 2 }),
    );
    expect(v.hold).toBe(true);
    expect(v.varianceCartons).toBe(-1);
  });

  it('no expectation => informational, never a hold', () => {
    const v = computeVariance(session([carton({})]));
    expect(v.hold).toBe(false);
    expect(statusLabel(v)).toBe('NO EXPECTED');
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
