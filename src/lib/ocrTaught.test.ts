// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_OCR_MIN_CONFIDENCE,
  getOcrMinConfidence,
  setOcrMinConfidence,
  OCR_REGION,
  TAUGHT_REGION_SIZE,
  parseWeightTaught,
  regionFromProfile,
} from './ocr';

const region = (weightRegion: string | null) => ({ weightRegion });

describe('regionFromProfile', () => {
  it('falls back to the larger centred default with no profile', () => {
    expect(regionFromProfile(undefined)).toEqual(OCR_REGION);
    expect(regionFromProfile(null)).toEqual(OCR_REGION);
  });

  it('tightens the crop whenever a label is taught — even without a zone', () => {
    for (const r of [regionFromProfile(region(null)), regionFromProfile(region('bottom right'))]) {
      expect(r.widthFrac).toBe(TAUGHT_REGION_SIZE.widthFrac);
      expect(r.heightFrac).toBe(TAUGHT_REGION_SIZE.heightFrac);
      expect(r.widthFrac).toBeLessThan(OCR_REGION.widthFrac);
      expect(r.heightFrac).toBeLessThan(OCR_REGION.heightFrac);
    }
  });

  it('shifts toward the taught zone', () => {
    const br = regionFromProfile(region('bottom-right, inside the boxed grid'));
    expect(br.centerYFrac).toBeGreaterThan(0.5);
    expect(br.centerXFrac).toBeGreaterThan(0.5);

    const tl = regionFromProfile(region('top left corner'));
    expect(tl.centerYFrac).toBeLessThan(0.5);
    expect(tl.centerXFrac).toBeLessThan(0.5);
  });

  it('when both of a pair appear, the first mentioned wins', () => {
    // real AI output: "center-left, right of the anchor labels stack"
    const r = regionFromProfile(region('center-left, right of the anchor labels stack'));
    expect(r.centerXFrac).toBeLessThan(0.5);
    expect(r.centerYFrac).toBe(0.5);
  });

  it('keeps the crop inside the frame', () => {
    for (const map of [region('top left'), region('bottom right'), undefined]) {
      const r = regionFromProfile(map);
      expect(r.centerXFrac - r.widthFrac / 2).toBeGreaterThanOrEqual(0);
      expect(r.centerXFrac + r.widthFrac / 2).toBeLessThanOrEqual(1);
      expect(r.centerYFrac - r.heightFrac / 2).toBeGreaterThanOrEqual(0);
      expect(r.centerYFrac + r.heightFrac / 2).toBeLessThanOrEqual(1);
    }
  });
});

describe('OCR confidence gate setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults, persists, and clamps', () => {
    expect(getOcrMinConfidence()).toBe(DEFAULT_OCR_MIN_CONFIDENCE);
    setOcrMinConfidence(40);
    expect(getOcrMinConfidence()).toBe(40);
    setOcrMinConfidence(5); // below the floor
    expect(getOcrMinConfidence()).toBe(20);
    setOcrMinConfidence(200); // above the ceiling
    expect(getOcrMinConfidence()).toBe(95);
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem('cw.ocrMinConfidence', '"not a number"');
    expect(getOcrMinConfidence()).toBe(DEFAULT_OCR_MIN_CONFIDENCE);
  });
});

describe('parseWeightTaught', () => {
  const taughtKg2dp = { unit: 'kg' as const, decimalPlaces: 2, anchorText: 'Nett Weight' };

  it('without expectations behaves like plain parsing', () => {
    expect(parseWeightTaught('18.82 kg')).toMatchObject({ value: 18.82, unit: 'kg', unitExplicit: true });
  });

  it('a valid read matching the taught format passes, obviously', () => {
    expect(parseWeightTaught('14.54 kg', taughtKg2dp)).toMatchObject({
      value: 14.54,
      unit: 'kg',
      unitExplicit: true,
      hasDecimal: true,
    });
  });

  it('locks onto the kg value on a dual-print label, either order', () => {
    // Taylor Preston style: "14.54 kg" stacked over "32.06 lb"
    expect(parseWeightTaught('Nett Weight 14.54 kg 32.06 lb', taughtKg2dp)?.value).toBe(14.54);
    expect(parseWeightTaught('32.06 lb 14.54 kg', taughtKg2dp)?.value).toBe(14.54);
    expect(parseWeightTaught('32.06 lb 14.54 kg', taughtKg2dp)?.unit).toBe('kg');
  });

  it('the field bug: a stray fragment digit must not beat the real weight', () => {
    // OCR caught a stray "2" (edge of the lb line) alongside the true value —
    // the old code rejected the whole read; now selection picks 14.54.
    expect(parseWeightTaught('2 14.54 kg', taughtKg2dp)?.value).toBe(14.54);
    expect(parseWeightTaught('14.54 2', taughtKg2dp)?.value).toBe(14.54);
  });

  it('prefers the number after the taught anchor text', () => {
    const w = parseWeightTaught('GROSS 19.20 NET 18.82', {
      unit: 'kg',
      decimalPlaces: 2,
      anchorText: 'NET WEIGHT',
    });
    expect(w?.value).toBe(18.82);
  });

  it('keeps the explicit unit when the anchor contains the unit word', () => {
    expect(parseWeightTaught('Net kg 12.43', { unit: 'kg', decimalPlaces: 2, anchorText: 'Net kg' })).toMatchObject(
      { value: 12.43, unit: 'kg', unitExplicit: true },
    );
  });

  it('never rejects for a format quibble — decimals are a hint, not a gate', () => {
    // wrong decimal count, integer-only, trailing dot: all still returned;
    // the missed-decimal/range guardrails decide what happens next.
    expect(parseWeightTaught('18.6 kg', taughtKg2dp)?.value).toBe(18.6);
    expect(parseWeightTaught('1864', taughtKg2dp)?.value).toBe(1864);
    expect(parseWeightTaught('18. kg', taughtKg2dp)?.value).toBe(18);
  });

  it('an lb-only read on a kg-taught label is kept (converts correctly downstream)', () => {
    // The crop caught only the lb line: 32.06 lb IS the same weight as
    // 14.54 kg — the explicit unit makes the downstream conversion right.
    expect(parseWeightTaught('32.06 lb', taughtKg2dp)).toMatchObject({
      value: 32.06,
      unit: 'lb',
      unitExplicit: true,
    });
  });

  it('a unit-less read resolves to the taught unit but still forces the confirm', () => {
    expect(parseWeightTaught('14.54', taughtKg2dp)).toMatchObject({
      value: 14.54,
      unit: 'kg',
      unitExplicit: false, // unit-not-read guardrail fires as always
    });
  });

  it('returns null only when no number was read at all', () => {
    expect(parseWeightTaught('KEEP REFRIGERATED', taughtKg2dp)).toBeNull();
  });
});
