import { describe, it, expect } from 'vitest';
import { classifyRescan, type RescanFields } from './rescan';

/**
 * The Fribin pork shoulder label that exposed the bug: every carton of the
 * batch prints an IDENTICAL GS1 string — GTIN, best-before, 7.71 kg net and
 * batch, with no AI 21 serial. The unique numbers (26706830, 26706916,
 * 26706849) are printed and in a separate barcode, never in this string.
 */
const FRIBIN = '(01)98420945798131(15)280223(3102)000771(10)602230529';
const fribinCarton: RescanFields = { gtin: '98420945798131', raw: FRIBIN };

/** A Teys label of the same product, which DOES carry a serial. */
const serialCarton: RescanFields = {
  gtin: '99332218351761',
  serial: '090000400447',
  raw: '(01)99332218351761(3102)001754(13)260630(21)090000400447',
};

describe('serial-less labels: identical strings are DIFFERENT cartons', () => {
  it('does not block a second Fribin carton with the identical barcode', () => {
    const verdict = classifyRescan([fribinCarton], { gtin: '98420945798131', raw: FRIBIN });
    expect(verdict.kind).toBe('repeat'); // counted, with a notice — never blocked
  });

  it('a whole pallet of identical serial-less cartons all count', () => {
    const counted: RescanFields[] = [];
    for (let i = 0; i < 20; i++) {
      const verdict = classifyRescan(counted, { gtin: '98420945798131', raw: FRIBIN });
      expect(verdict.kind).not.toBe('duplicate'); // nothing is ever blocked
      counted.push({ ...fribinCarton });
    }
    expect(counted).toHaveLength(20);
  });

  it('the first scan of a serial-less label is simply new', () => {
    expect(classifyRescan([], { gtin: '98420945798131', raw: FRIBIN }).kind).toBe('new');
  });

  it('a different serial-less product is new, not a repeat', () => {
    const other = '(01)98420945798148(15)280223(3102)000812(10)602230529';
    expect(classifyRescan([fribinCarton], { gtin: '98420945798148', raw: other }).kind).toBe('new');
  });
});

describe('labels WITH a serial: an identical repeat is a real duplicate', () => {
  it('blocks the same GTIN + serial and names the serial', () => {
    const verdict = classifyRescan([serialCarton], {
      gtin: '99332218351761',
      serial: '090000400447',
      raw: serialCarton.raw,
    });
    expect(verdict.kind).toBe('duplicate');
    if (verdict.kind !== 'duplicate') return;
    expect(verdict.serial).toBe('090000400447');
  });

  it('blocks on the serial even when the scanner returns a different string form', () => {
    const verdict = classifyRescan([serialCarton], {
      gtin: '99332218351761',
      serial: '090000400447',
      raw: ']C1019933221835176131020017541326063021090000400447',
    });
    expect(verdict.kind).toBe('duplicate');
  });

  it('a DIFFERENT serial on the same product counts', () => {
    expect(
      classifyRescan([serialCarton], {
        gtin: '99332218351761',
        serial: '090000400448',
        raw: 'anything-else',
      }).kind,
    ).toBe('new');
  });

  it('a serialised scan is never demoted to a repeat by a matching raw', () => {
    // Same raw string, but the serial says it's a new carton -> must be 'new'.
    const verdict = classifyRescan([{ gtin: 'G', serial: 'S1', raw: 'SAME' }], {
      gtin: 'G',
      serial: 'S2',
      raw: 'SAME',
    });
    expect(verdict.kind).toBe('new');
  });
});

describe('hand-keyed cartons stay out of it', () => {
  it('manual/OCR/AI records (no raw) never match a later scan', () => {
    const manual: RescanFields = { gtin: '98420945798131' }; // no raw, no serial
    expect(classifyRescan([manual], { gtin: '98420945798131', raw: FRIBIN }).kind).toBe('new');
  });

  it('a scan with no raw and no serial is always new', () => {
    expect(classifyRescan([fribinCarton], { gtin: '98420945798131' }).kind).toBe('new');
  });
});
