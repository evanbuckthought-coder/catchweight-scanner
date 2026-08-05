import { describe, it, expect } from 'vitest';
import { parseGS1, GS, type ParsedCarton } from './gs1';
import { SAMPLE_LABELS } from './testData';
import { suggestSupplier } from './suppliers';
import { LB_TO_KG, roundKg } from './units';

/** Pretty one-line summary of a parsed carton for console output. */
function summarise(c: ParsedCarton): string {
  const dates = [
    c.productionDate && `prod=${c.productionDate}`,
    c.packagingDate && `pkg=${c.packagingDate}`,
    c.bestBefore && `bb=${c.bestBefore}`,
    c.useBy && `useby=${c.useBy}`,
  ].filter(Boolean).join(' ');
  return [
    `GTIN ${c.gtin}`,
    `${c.netWeight}${c.weightUnit} -> ${roundKg(c.weightKg ?? 0)}kg`,
    `${c.traceAI === '10' ? 'batch' : 'serial'}=${c.traceId}`,
    `prefix=${c.companyPrefix}`,
    `supplier=${suggestSupplier(c.gtin) ?? '(unknown)'}`,
    dates && `[${dates}]`,
    `fp=${c.fingerprint}`,
  ].filter(Boolean).join('  ');
}

describe('GS1-128 parser — five real labels', () => {
  it('parses every sample as valid with the right weight & unit', () => {
    let total = 0;
    console.log('\n=== Parsed cartons ===');
    for (const sample of SAMPLE_LABELS) {
      const c = parseGS1(sample.code);
      console.log(`\n${sample.label}`);
      console.log(`  ${summarise(c)}`);
      expect(c.valid, `expected ${sample.label} to be valid; errors: ${c.errors.join(', ')}`).toBe(true);
      expect(c.errors).toHaveLength(0);
      expect(roundKg(c.weightKg!)).toBeCloseTo(roundKg(sample.expectedKg), 3);
      expect(suggestSupplier(c.gtin)).toBe(sample.supplier);
      total += c.weightKg!;
    }
    const expectedTotal = SAMPLE_LABELS.reduce((s, l) => s + l.expectedKg, 0);
    console.log('\n=== Pallet total ===');
    console.log(`  ${roundKg(total)} kg across ${SAMPLE_LABELS.length} cartons`);
    expect(roundKg(total)).toBeCloseTo(roundKg(expectedTotal), 3);
  });

  it('Fribin pork: kg weight, best-before date, batch trace id', () => {
    const c = parseGS1('(01)98420945601325(15)280203(3102)000705(10)602030219');
    expect(c.gtin).toBe('98420945601325');
    expect(c.weightUnit).toBe('kg');
    expect(c.netWeight).toBeCloseTo(7.05, 3);
    expect(c.weightKg).toBeCloseTo(7.05, 3);
    expect(c.bestBefore).toBe('2028-02-03');
    expect(c.productionDate).toBeUndefined();
    expect(c.batch).toBe('602030219');
    expect(c.traceId).toBe('602030219');
    expect(c.traceAI).toBe('10');
  });

  it('Davmet lamb: production date present, batch trace id', () => {
    const c = parseGS1('(01)99420023200173(3102)001324(11)260202(10)6034080028');
    expect(c.netWeight).toBeCloseTo(13.24, 3);
    expect(c.productionDate).toBe('2026-02-02');
    expect(c.traceAI).toBe('10');
    expect(c.traceId).toBe('6034080028');
  });

  it('Teys beef: packaging date, serial trace id (no batch)', () => {
    const c = parseGS1('(01)99332218021206(3102)002113(13)251211(21)050073950220');
    expect(c.netWeight).toBeCloseTo(21.13, 3);
    expect(c.packagingDate).toBe('2025-12-11');
    expect(c.batch).toBeUndefined();
    expect(c.serial).toBe('050073950220');
    expect(c.traceAI).toBe('21');
    expect(c.traceId).toBe('050073950220');
  });

  it('Smithfield pork: pounds (3202) normalised to kg', () => {
    const c = parseGS1('(01)90070247165421(3202)002165(13)260310(21)116069056422');
    expect(c.weightAI).toBe('3202');
    expect(c.weightUnit).toBe('lb');
    expect(c.netWeight).toBeCloseTo(21.65, 3);
    expect(c.weightKg).toBeCloseTo(21.65 * 0.45359237, 5);
    expect(c.packagingDate).toBe('2026-03-10');
  });
});

describe('GS1-128 parser — raw scanner form (FNC1 / GS separators)', () => {
  it('parses raw output with GS-terminated variable fields the same as parenthesised', () => {
    // Same as Fribin label, but raw: 01 fixed(14), 15 fixed(6), 3102 fixed(6),
    // 10 variable terminated by GS / end.
    const raw = `0198420945601325152802033102000705${''}10602030219`;
    const c = parseGS1(raw);
    expect(c.gtin).toBe('98420945601325');
    expect(c.bestBefore).toBe('2028-02-03');
    expect(c.netWeight).toBeCloseTo(7.05, 3);
    expect(c.batch).toBe('602030219');
    expect(c.valid).toBe(true);
  });

  it('handles a GS between two variable fields', () => {
    // 01 ... 10<batch>GS 21<serial>  (batch then serial, both variable)
    const raw = `019842094560132510ABC123${GS}21XYZ789`;
    const c = parseGS1(raw);
    expect(c.batch).toBe('ABC123');
    expect(c.serial).toBe('XYZ789');
    expect(c.traceAI).toBe('10'); // batch wins
  });

  it('strips a leading AIM symbology identifier (]C1)', () => {
    // ]C1 + 01<gtin> + 3102<weight> + 10<batch>
    const c = parseGS1(']C1' + '0198420945601325' + '3102000705' + '1062030219');
    expect(c.gtin).toBe('98420945601325');
    expect(c.netWeight).toBeCloseTo(7.05, 3);
    expect(c.batch).toBe('62030219');
  });
});

describe('GS1-128 parser — graceful failure', () => {
  it('flags an unknown AI instead of guessing', () => {
    const c = parseGS1('(01)98420945601325(99)whoknows');
    expect(c.valid).toBe(false);
    expect(c.errors.some((e) => e.includes('No net weight'))).toBe(true);
  });

  it('flags a label with no GTIN', () => {
    const c = parseGS1('(3102)000705(10)602030219');
    expect(c.valid).toBe(false);
    expect(c.errors.some((e) => e.includes('No GTIN'))).toBe(true);
  });
});

describe('net-weight AI family — every decimal variant (310n kg, 320n lb)', () => {
  const GTIN = '(01)94015433211209';

  // [ai, 6-digit data, decoded value in the AI's own unit]
  const KG_CASES: [string, string, number][] = [
    ['3100', '000014', 14],
    ['3101', '000144', 14.4],
    ['3102', '001446', 14.46],
    ['3103', '014465', 14.465],
    ['3104', '144652', 14.4652],
    ['3105', '146521', 1.46521],
  ];
  const LB_CASES: [string, string, number][] = [
    ['3200', '000032', 32],
    ['3201', '000320', 32],
    ['3202', '003206', 32.06],
    ['3203', '032065', 32.065],
    ['3204', '320655', 32.0655],
    ['3205', '320655', 3.20655],
  ];

  it.each(KG_CASES)('%s decodes %s as %d kg (parenthesised AND raw)', (ai, data, value) => {
    for (const input of [`${GTIN}(${ai})${data}`, `0194015433211209${ai}${data}`]) {
      const c = parseGS1(input);
      expect(c.valid).toBe(true);
      expect(c.weightAI).toBe(ai);
      expect(c.weightUnit).toBe('kg');
      expect(c.netWeight).toBeCloseTo(value, 6);
      expect(c.weightKg).toBeCloseTo(value, 6);
    }
  });

  it.each(LB_CASES)('%s decodes %s as %d lb, normalised to kg', (ai, data, value) => {
    for (const input of [`${GTIN}(${ai})${data}`, `0194015433211209${ai}${data}`]) {
      const c = parseGS1(input);
      expect(c.valid).toBe(true);
      expect(c.weightAI).toBe(ai);
      expect(c.weightUnit).toBe('lb');
      expect(c.netWeight).toBeCloseTo(value, 6);
      expect(c.weightKg).toBeCloseTo(value * LB_TO_KG, 6);
    }
  });
});

describe('gross weight is never the carton weight', () => {
  const GTIN = '(01)94015433211209';

  it('gross-only (330n) is FLAGGED, not silently used as net', () => {
    const c = parseGS1(`${GTIN}(3302)002694`);
    expect(c.valid).toBe(false);
    expect(c.weightKg).toBeUndefined();
    expect(c.grossKg).toBeCloseTo(26.94, 3);
    expect(c.grossAI).toBe('3302');
    expect(c.errors.some((e) => e.includes('Only GROSS weight'))).toBe(true);
  });

  it('gross-only lb (340n) is flagged the same way', () => {
    const c = parseGS1(`${GTIN}(3402)005941`);
    expect(c.valid).toBe(false);
    expect(c.grossUnit).toBe('lb');
    expect(c.grossKg).toBeCloseTo(59.41 * LB_TO_KG, 4);
  });

  it('net + gross together -> NET is the carton weight, gross kept for reference', () => {
    const c = parseGS1(`${GTIN}(3302)002694(3102)002246`);
    expect(c.valid).toBe(true);
    expect(c.weightKg).toBeCloseTo(22.46, 3);
    expect(c.weightAI).toBe('3102');
    expect(c.grossKg).toBeCloseTo(26.94, 3);
  });

  it('RAW scanner form: a gross weight BEFORE the net must not derail the walk', () => {
    const raw = `01940154332112093302002694310200224610P0447`;
    const c = parseGS1(raw);
    expect(c.valid).toBe(true);
    expect(c.weightKg).toBeCloseTo(22.46, 3);
    expect(c.batch).toBe('P0447');
    expect(c.grossKg).toBeCloseTo(26.94, 3);
  });

  it('dual-unit label (kg + lb net): kg wins regardless of order', () => {
    const c = parseGS1(`${GTIN}(3202)003206(3102)001454`);
    expect(c.weightUnit).toBe('kg');
    expect(c.weightAI).toBe('3102');
    expect(c.weightKg).toBeCloseTo(14.54, 3);
  });

  it('non-weight measures (volume, length) are ignored for weight, not fatal', () => {
    // 3150n = net volume (litres), 3110n = length — neither is a weight.
    const c = parseGS1(`0194015433211209315000050031100001233102002246`);
    expect(c.valid).toBe(true);
    expect(c.weightKg).toBeCloseTo(22.46, 3);
    expect(c.unknownAIs.map((u) => u.ai)).toEqual(['3150', '3110']);
  });
});

describe('diagnostics — a missed weight is visible, never silent', () => {
  it('GTIN but no weight lists WHICH AIs were present', () => {
    const c = parseGS1('(01)19414735674029(17)260727(10)P0447');
    expect(c.valid).toBe(false);
    const err = c.errors.find((e) => e.includes('No net weight'));
    expect(err).toContain('AIs present: 01, 17, 10');
  });
});

describe('full AI audit — everything a catchweight label carries, one raw scan', () => {
  it('00 + 01 + 11/13/15/17 + 310n + 37 + 10 + 21 all decode together', () => {
    const raw =
      '00' + '345678901234567890' + // SSCC (18, fixed)
      '01' + '94015433211209' +
      '11' + '260607' + '13' + '260612' + '15' + '260726' + '17' + '260801' +
      '3103' + '014465' +
      '37' + '12' + GS + // count (variable, GS-terminated)
      '10' + 'P0447' + GS + // batch (variable, GS-terminated)
      '21' + '001284'; // serial (variable, end of string)
    const c = parseGS1(raw);
    expect(c.errors).toEqual([]);
    expect(c.valid).toBe(true);
    expect(c.sscc).toBe('345678901234567890');
    expect(c.gtin).toBe('94015433211209');
    expect(c.productionDate).toBe('2026-06-07');
    expect(c.packagingDate).toBe('2026-06-12');
    expect(c.bestBefore).toBe('2026-07-26');
    expect(c.useBy).toBe('2026-08-01');
    expect(c.weightKg).toBeCloseTo(14.465, 4);
    expect(c.weightAI).toBe('3103');
    expect(c.count).toBe('12');
    expect(c.batch).toBe('P0447');
    expect(c.serial).toBe('001284');
    expect(c.traceAI).toBe('10'); // batch wins as trace id
  });

  it('the same AIs in a different order decode identically', () => {
    const raw =
      '10' + 'P0447' + GS +
      '3103' + '014465' +
      '01' + '94015433211209' +
      '17' + '260801';
    const c = parseGS1(raw);
    expect(c.valid).toBe(true);
    expect(c.gtin).toBe('94015433211209');
    expect(c.weightKg).toBeCloseTo(14.465, 4);
    expect(c.batch).toBe('P0447');
    expect(c.useBy).toBe('2026-08-01');
  });
});
