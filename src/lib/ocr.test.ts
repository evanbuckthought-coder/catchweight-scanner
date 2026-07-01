import { describe, it, expect } from 'vitest';
import { parseWeightText, ocrToParsed } from './ocr';

describe('parseWeightText', () => {
  it('reads a plain kg weight', () => {
    expect(parseWeightText('18.64 kg')).toEqual({ value: 18.64, unit: 'kg', hasDecimal: true });
  });

  it('reads a lb weight', () => {
    expect(parseWeightText('NET WT 41.1 lb')).toEqual({ value: 41.1, unit: 'lb', hasDecimal: true });
  });

  it('defaults to kg when no unit is visible', () => {
    expect(parseWeightText('13.62')).toEqual({ value: 13.62, unit: 'kg', hasDecimal: true });
  });

  it('captures an integer (possible missed decimal) rather than dropping it', () => {
    expect(parseWeightText('186')).toEqual({ value: 186, unit: 'kg', hasDecimal: false });
  });

  it('hasDecimal keys solely on the presence of ".", not the digits after it', () => {
    // 2, 1 and 0 trailing digits all count as having a decimal.
    expect(parseWeightText('18.02 kg')).toEqual({ value: 18.02, unit: 'kg', hasDecimal: true });
    expect(parseWeightText('18.00 kg')).toEqual({ value: 18, unit: 'kg', hasDecimal: true });
    expect(parseWeightText('18.0 kg')).toEqual({ value: 18, unit: 'kg', hasDecimal: true });
    expect(parseWeightText('18. kg')).toEqual({ value: 18, unit: 'kg', hasDecimal: true });
    // 3 dp (some scales print to the gram) must not fall back to "18"/no-decimal.
    expect(parseWeightText('18.643 kg')).toEqual({ value: 18.643, unit: 'kg', hasDecimal: true });
    // Only a bare integer is flagged — the signature of a dropped decimal.
    expect(parseWeightText('18 kg')).toEqual({ value: 18, unit: 'kg', hasDecimal: false });
    expect(parseWeightText('1864 kg')).toEqual({ value: 1864, unit: 'kg', hasDecimal: false });
  });

  it('treats a comma as a decimal point (EU labels)', () => {
    expect(parseWeightText('12,5 kg')).toEqual({ value: 12.5, unit: 'kg', hasDecimal: true });
  });

  it('prefers the number adjacent to the unit over other numbers', () => {
    expect(parseWeightText('Best before 2026 18.64 kg')).toEqual({
      value: 18.64,
      unit: 'kg',
      hasDecimal: true,
    });
  });

  it('prefers a decimal-bearing number when no unit is adjacent', () => {
    expect(parseWeightText('20261211 18.64')).toMatchObject({ value: 18.64, hasDecimal: true });
  });

  it('returns null for text with no usable number', () => {
    expect(parseWeightText('')).toBeNull();
    expect(parseWeightText('FROZEN BEEF')).toBeNull();
    expect(parseWeightText('0 kg')).toBeNull();
  });
});

describe('ocrToParsed', () => {
  it('wraps an OCR read as a valid ParsedCarton with kg normalisation', () => {
    const p = ocrToParsed({ value: 41.1, unit: 'lb', text: '41.1 lb' }, { gtin: '99332218021206', batch: 'B1' });
    expect(p.valid).toBe(true);
    expect(p.weightKg).toBeCloseTo(41.1 * 0.45359237, 4);
    expect(p.gtin).toBe('99332218021206');
    expect(p.batch).toBe('B1');
    expect(p.traceAI).toBe('10');
    expect(p.raw).toContain('OCR');
    expect(p.fingerprint).toBe('ocr');
  });

  it('works without gtin/batch (OCR-started product)', () => {
    const p = ocrToParsed({ value: 10.5, unit: 'kg', text: '10.5 kg' });
    expect(p.valid).toBe(true);
    expect(p.gtin).toBeUndefined();
    expect(p.traceId).toBeUndefined();
  });
});
