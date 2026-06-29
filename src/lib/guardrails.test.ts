import { describe, it, expect } from 'vitest';
import { weightWarnings } from './guardrails';

describe('weight guardrails', () => {
  it('accepts a normal catchweight value (in range, has decimal)', () => {
    expect(weightWarnings({ weightKg: 18.64, netWeight: 18.64, isScan: true })).toEqual([]);
    expect(weightWarnings({ weightKg: 7.05, netWeight: 7.05, isScan: true })).toEqual([]);
  });

  it('warns below 1 kg and above 40 kg', () => {
    expect(weightWarnings({ weightKg: 0.5, netWeight: 0.5, isScan: true })[0]).toContain('outside the normal carton range');
    expect(weightWarnings({ weightKg: 41.2, netWeight: 41.2, isScan: true })[0]).toContain('1–40 kg');
  });

  it('accepts the inclusive boundaries 1.00 and 40.00', () => {
    expect(weightWarnings({ weightKg: 1, netWeight: 1.0, isScan: false })).toEqual([]);
    expect(weightWarnings({ weightKg: 40, netWeight: 40.0, isScan: false })).toEqual([]);
  });

  it('scan with no decimal (integer value) -> missed-decimal warning', () => {
    const w = weightWarnings({ weightKg: 18, netWeight: 18, isScan: true });
    expect(w.some((m) => m.includes('No decimal point detected'))).toBe(true);
  });

  it('a misread like 186 trips both range AND no-decimal warnings', () => {
    const w = weightWarnings({ weightKg: 186, netWeight: 186, isScan: true });
    expect(w).toHaveLength(2);
  });

  it('manual (isScan=false) only gets the range check, never the decimal one', () => {
    // 12 kg is a round in-range weight: no warnings for manual.
    expect(weightWarnings({ weightKg: 12, netWeight: 12, isScan: false })).toEqual([]);
    // but out of range manual still warns
    expect(weightWarnings({ weightKg: 0.2, netWeight: 0.2, isScan: false })).toHaveLength(1);
  });
});
