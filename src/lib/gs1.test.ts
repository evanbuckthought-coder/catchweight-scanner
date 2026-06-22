import { describe, it, expect } from 'vitest';
import { parseGS1, GS, type ParsedCarton } from './gs1';
import { SAMPLE_LABELS } from './testData';
import { suggestSupplier } from './suppliers';
import { roundKg } from './units';

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
