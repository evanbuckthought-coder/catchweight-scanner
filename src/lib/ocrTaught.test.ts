import { describe, it, expect } from 'vitest';
import { OCR_REGION, parseWeightTaught, regionFromProfile } from './ocr';

describe('regionFromProfile', () => {
  it('defaults to the centred region when nothing is taught', () => {
    expect(regionFromProfile(undefined)).toEqual(OCR_REGION);
    expect(regionFromProfile(null)).toEqual(OCR_REGION);
    expect(regionFromProfile('somewhere on the label')).toEqual(OCR_REGION);
  });

  it('shifts toward the taught zone', () => {
    const br = regionFromProfile('bottom-right, inside the boxed grid');
    expect(br.centerYFrac).toBeGreaterThan(0.5);
    expect(br.centerXFrac).toBeGreaterThan(0.5);

    const tl = regionFromProfile('top left corner');
    expect(tl.centerYFrac).toBeLessThan(0.5);
    expect(tl.centerXFrac).toBeLessThan(0.5);
  });

  it('when both of a pair appear, the first mentioned wins', () => {
    // real AI output: "center-left, right of the anchor labels stack"
    const r = regionFromProfile('center-left, right of the anchor labels stack');
    expect(r.centerXFrac).toBeLessThan(0.5);
    expect(r.centerYFrac).toBe(0.5);
  });

  it('keeps the crop inside the frame', () => {
    for (const text of ['top left', 'bottom right', undefined]) {
      const r = regionFromProfile(text);
      expect(r.centerXFrac - r.widthFrac / 2).toBeGreaterThanOrEqual(0);
      expect(r.centerXFrac + r.widthFrac / 2).toBeLessThanOrEqual(1);
      expect(r.centerYFrac - r.heightFrac / 2).toBeGreaterThanOrEqual(0);
      expect(r.centerYFrac + r.heightFrac / 2).toBeLessThanOrEqual(1);
    }
  });
});

describe('parseWeightTaught', () => {
  it('without expectations behaves like plain parsing', () => {
    const { w, rejected } = parseWeightTaught('18.82 kg');
    expect(rejected).toBeUndefined();
    expect(w).toMatchObject({ value: 18.82, unit: 'kg', unitExplicit: true });
  });

  it('prefers the number after the taught anchor text', () => {
    // Plain parsing would take 19.20 (first decimal number); the anchor
    // steers to the net weight that follows it.
    const { w } = parseWeightTaught('GROSS 19.20 NET 18.82', {
      unit: 'kg',
      decimalPlaces: 2,
      anchorText: 'NET WEIGHT',
    });
    expect(w?.value).toBe(18.82);
  });

  it('recovers the explicit unit when the anchor slice cuts it off', () => {
    // Anchor "Net kg" ends after "kg", slicing the unit away from "12.43" —
    // the whole-line parse restores unitExplicit.
    const { w } = parseWeightTaught('Net kg 12.43', {
      unit: 'kg',
      decimalPlaces: 2,
      anchorText: 'Net kg',
    });
    expect(w).toMatchObject({ value: 12.43, unit: 'kg' });
  });

  it('rejects an explicit unit that contradicts the taught unit', () => {
    // e.g. the lb line of a dual-print label when the label is taught kg
    const { w, rejected } = parseWeightTaught('41.5 lb', { unit: 'kg', decimalPlaces: 2 });
    expect(w).toBeNull();
    expect(rejected).toMatch(/lb/);
    expect(rejected).toMatch(/kg/);
  });

  it('rejects reads whose decimal count contradicts the taught format', () => {
    const expectations = { unit: 'kg' as const, decimalPlaces: 2 };
    expect(parseWeightTaught('1864', expectations).rejected).toMatch(/1864.*2 decimals/);
    expect(parseWeightTaught('18.6 kg', expectations).rejected).toMatch(/18\.6.*2 decimals/);
    expect(parseWeightTaught('18. kg', expectations).rejected).toBeTruthy();
  });

  it('accepts reads matching the taught format', () => {
    const { w, rejected } = parseWeightTaught('NET WEIGHT 18.82 kg', {
      unit: 'kg',
      decimalPlaces: 2,
      anchorText: 'NET WEIGHT',
    });
    expect(rejected).toBeUndefined();
    expect(w).toMatchObject({ value: 18.82, unit: 'kg', hasDecimal: true });
  });

  it('leaves format-checking to the guardrails when nothing was taught about it', () => {
    // decimalPlaces null -> integer reads pass through so the missed-decimal
    // guardrail (not this filter) handles them.
    const { w, rejected } = parseWeightTaught('1864', { unit: 'kg', decimalPlaces: null });
    expect(rejected).toBeUndefined();
    expect(w?.value).toBe(1864);
  });
});
