// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseScan } from './scan';
import { saveBarcodeMap, loadBarcodeMaps, type BarcodeFormatMap } from './barcodeMaps';
import { cartonKey } from './gs1';

const BRISKET = '20780015324068137124';
const NOW = Date.UTC(2026, 6, 23);

const NZ_MAP: BarcodeFormatMap = {
  formatName: 'NZ legacy 20-digit meat carton',
  totalLength: 20,
  fields: {
    netWeight: { start: 6, length: 3, encoding: 'integer', multiplier: 0.1, unit: 'kg', printedValueSeen: '15.3 kg', confidence: 0.95 },
    productionDate: { start: 9, length: 5, encoding: 'yy-dayofyear', printedValueSeen: '08 Mar 24', confidence: 0.9 },
    productCode: { start: 1, length: 5, printedValueSeen: '07-800', confidence: 0.9 },
    serial: { start: 14, length: 4, printedValueSeen: '1371', confidence: 0.8 },
    bestBefore: null,
  },
  signature: { length: 20, prefix: '2', prefixLength: 1 },
  verification: { weightMatchesPrinted: true, dateMatchesPrinted: true, notes: null },
};

beforeEach(() => localStorage.clear());

describe('parseScan — GS1 always wins', () => {
  it('routes a valid GS1 barcode through the GS1 parser, never a custom map', () => {
    // A saved map whose signature would otherwise claim this 20-char string.
    saveBarcodeMap({ ...NZ_MAP, signature: { length: 20, prefix: '0', prefixLength: 1 } }, BRISKET);
    const gs1 = '0194015433211209' + '3102' + '002246'; // 26 chars, valid GS1
    const res = parseScan(gs1, loadBarcodeMaps(), NOW);
    expect(res.kind).toBe('carton');
    if (res.kind !== 'carton') return;
    expect(res.parsed.format).toBe('gs1');
    expect(res.map).toBeUndefined();
    expect(res.parsed.weightKg).toBeCloseTo(22.46, 3);
  });

  it('a 20-char GS1 string is not diverted to a same-length custom map', () => {
    saveBarcodeMap({ ...NZ_MAP, signature: { length: 20, prefix: '0', prefixLength: 1 } }, BRISKET);
    // 01 + 14-digit GTIN + 3102 -> invalid GS1 (weight data truncated), and
    // the map's prefix "0" matches. It must NOT be counted via the map.
    const res = parseScan('01940154332112093102', loadBarcodeMaps(), NOW);
    // The map would decode digits 6-8 = "433" -> 43.3 kg, out of range.
    expect(res.kind).toBe('refused');
  });
});

describe('parseScan — custom maps as the fallback', () => {
  it('is unreadable before any map is taught (so the UI can offer AI analysis)', () => {
    const res = parseScan(BRISKET, [], NOW);
    expect(res.kind).toBe('unreadable');
    if (res.kind !== 'unreadable') return;
    expect(res.raw).toBe(BRISKET);
    expect(res.reason).toBeTruthy();
  });

  it('decodes on-device once the map is saved', () => {
    saveBarcodeMap(NZ_MAP, BRISKET);
    const res = parseScan(BRISKET, loadBarcodeMaps(), NOW);
    expect(res.kind).toBe('carton');
    if (res.kind !== 'carton') return;
    expect(res.parsed.format).toBe('custom');
    expect(res.parsed.weightKg).toBeCloseTo(15.3, 3);
    expect(res.parsed.productionDate).toBe('2024-03-08');
    expect(res.parsed.itemCode).toBe('07800');
    expect(res.parsed.serial).toBe('1371');
    expect(res.parsed.valid).toBe(true);
    expect(res.parsed.raw).toBe(BRISKET); // audit trail kept
    expect(cartonKey(res.parsed)).toBe('07800'); // identity for dedupe/profiles
  });

  it('REFUSES rather than counts when a claimed barcode fails validation', () => {
    saveBarcodeMap(NZ_MAP, BRISKET);
    const res = parseScan('20780099924068137124', loadBarcodeMaps(), NOW); // 99.9 kg
    expect(res.kind).toBe('refused');
    if (res.kind !== 'refused') return;
    expect(res.reason).toMatch(/outside/);
  });

  it('REFUSES an invalid production date', () => {
    saveBarcodeMap(NZ_MAP, BRISKET);
    expect(parseScan('20780015324999137124', loadBarcodeMaps(), NOW).kind).toBe('refused');
  });

  it('surfaces ambiguity instead of guessing', () => {
    saveBarcodeMap(NZ_MAP, BRISKET);
    saveBarcodeMap({ ...NZ_MAP, formatName: 'Second format' }, BRISKET);
    const res = parseScan(BRISKET, loadBarcodeMaps(), NOW);
    expect(res.kind).toBe('ambiguous');
  });

  it('cartonKey gives GS1 cartons their GTIN', () => {
    const res = parseScan('(01)94015433211209(3102)002246', [], NOW);
    if (res.kind !== 'carton') throw new Error('expected carton');
    expect(cartonKey(res.parsed)).toBe('94015433211209');
  });
});
