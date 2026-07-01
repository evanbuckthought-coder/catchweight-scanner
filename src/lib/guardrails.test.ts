import { describe, it, expect } from 'vitest';
import { weightWarnings } from './guardrails';

describe('weight guardrails', () => {
  it('accepts a normal catchweight value (in range, decimal present)', () => {
    expect(weightWarnings({ weightKg: 18.64, hasDecimal: true, requireDecimal: true })).toEqual([]);
    expect(weightWarnings({ weightKg: 7.05 })).toEqual([]);
  });

  it('warns below 1 kg and above 40 kg', () => {
    expect(weightWarnings({ weightKg: 0.5 })[0]).toContain('outside the normal carton range');
    expect(weightWarnings({ weightKg: 41.2 })[0]).toContain('1–40 kg');
  });

  it('accepts the inclusive boundaries 1.00 and 40.00', () => {
    expect(weightWarnings({ weightKg: 1 })).toEqual([]);
    expect(weightWarnings({ weightKg: 40 })).toEqual([]);
  });

  it('OCR read (requireDecimal) with no decimal -> missed-decimal warning', () => {
    const w = weightWarnings({ weightKg: 18, hasDecimal: false, requireDecimal: true });
    expect(w.some((m) => m.includes('No decimal point detected'))).toBe(true);
  });

  it('OCR read with a decimal -> no decimal warning', () => {
    expect(weightWarnings({ weightKg: 18.6, hasDecimal: true, requireDecimal: true })).toEqual([]);
  });

  it('a misread like 186 trips both range AND no-decimal warnings', () => {
    const w = weightWarnings({ weightKg: 186, hasDecimal: false, requireDecimal: true });
    expect(w).toHaveLength(2);
  });

  it('barcode/manual paths (no requireDecimal) never get the decimal warning', () => {
    expect(weightWarnings({ weightKg: 12, hasDecimal: false })).toEqual([]);
    // but out of range still warns
    expect(weightWarnings({ weightKg: 0.2, hasDecimal: false })).toHaveLength(1);
  });
});
