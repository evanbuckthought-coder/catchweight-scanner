// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  decodeWithMap,
  decodeWithSavedMaps,
  isMapConfirmedThisSession,
  loadBarcodeMaps,
  markMapConfirmed,
  removeBarcodeMap,
  resetSessionConfirmations,
  saveBarcodeMap,
  validateProposedMap,
  type BarcodeFormatMap,
} from './barcodeMaps';

/**
 * The real label this feature was built for: a legacy NZ meat carton whose
 * barcode is not GS1 at all.
 *
 *   2 07800 153 24068 1371 24
 *     │     │   │     └──── serial (printed "1371")
 *     │     │   └────────── production date, YY + day-of-year -> 8 Mar 2024
 *     │     └────────────── net weight x10 -> 15.3 kg
 *     └──────────────────── product code (printed "07-800")
 */
const BRISKET = '20780015324068137124';

/** A map of exactly the shape the AI is asked to return. */
const NZ_MAP: BarcodeFormatMap = {
  formatName: 'NZ legacy 20-digit meat carton',
  totalLength: 20,
  fields: {
    netWeight: {
      start: 6,
      length: 3,
      encoding: 'integer',
      multiplier: 0.1,
      unit: 'kg',
      printedValueSeen: '15.3 kg',
      confidence: 0.95,
    },
    productionDate: {
      start: 9,
      length: 5,
      encoding: 'yy-dayofyear',
      printedValueSeen: '08 Mar 24',
      confidence: 0.9,
    },
    productCode: { start: 1, length: 5, printedValueSeen: '07-800', confidence: 0.9 },
    serial: { start: 14, length: 4, printedValueSeen: '1371', confidence: 0.8 },
    bestBefore: null,
  },
  signature: { length: 20, prefix: '2', prefixLength: 1 },
  verification: {
    weightMatchesPrinted: true,
    dateMatchesPrinted: true,
    notes: 'Digits 6-8 reproduce the printed 15.3 kg; 9-13 reproduce 08 Mar 24.',
  },
};

/** Fixed "now" so plausibility checks never drift with the wall clock. */
const NOW = Date.UTC(2026, 6, 23);

/** Build a 20-digit code with swapped-in weight / date fields. */
const code = (weight = '153', date = '24068', serial = '137124') => `207800${weight}${date}${serial}`;

beforeEach(() => {
  localStorage.clear();
  resetSessionConfirmations();
});

describe('decoding the real label with a taught map', () => {
  it('decodes the example barcode to its printed values', () => {
    const res = decodeWithMap(BRISKET, NZ_MAP, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.decoded.weightKg).toBeCloseTo(15.3, 3); // printed "NET WEIGHT 15.3 kg"
    expect(res.decoded.netWeight).toBeCloseTo(15.3, 3);
    expect(res.decoded.unit).toBe('kg');
    expect(res.decoded.productionDate).toBe('2024-03-08'); // printed "08 Mar 24"
    expect(res.decoded.productCode).toBe('07800'); // printed "07-800"
    expect(res.decoded.serial).toBe('1371'); // printed "1371"
    expect(res.decoded.formatName).toBe('NZ legacy 20-digit meat carton');
  });

  it('decodes a DIFFERENT carton of the same format from its own digits', () => {
    // Same format, different carton: 22.7 kg, day 100 of 2024, other serial.
    const res = decodeWithMap(code('227', '24100', '137200'), NZ_MAP, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.decoded.weightKg).toBeCloseTo(22.7, 3);
    expect(res.decoded.productionDate).toBe('2024-04-09');
  });

  it('converts an lb-encoded format to kg', () => {
    const lbMap: BarcodeFormatMap = {
      ...NZ_MAP,
      fields: { ...NZ_MAP.fields, netWeight: { ...NZ_MAP.fields.netWeight!, unit: 'lb' } },
    };
    const res = decodeWithMap(code('338'), lbMap, NOW); // 33.8 lb
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.decoded.weightKg).toBeCloseTo(33.8 * 0.45359237, 4);
    expect(res.decoded.unit).toBe('lb');
  });
});

describe('every decode is re-validated — a bad value is never counted', () => {
  it('REFUSES a weight over the carton range', () => {
    const res = decodeWithMap(code('999'), NZ_MAP, NOW); // 99.9 kg
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/outside the 1–40 kg carton range/);
  });

  it('REFUSES a weight under the carton range', () => {
    expect(decodeWithMap(code('005'), NZ_MAP, NOW).ok).toBe(false); // 0.5 kg
  });

  it('REFUSES an invalid day-of-year', () => {
    expect(decodeWithMap(code('153', '24999'), NZ_MAP, NOW).ok).toBe(false); // day 999
    expect(decodeWithMap(code('153', '24000'), NZ_MAP, NOW).ok).toBe(false); // day 0
    // Day 366 of a NON-leap year would roll into the next year.
    expect(decodeWithMap(code('153', '25366'), NZ_MAP, NOW).ok).toBe(false);
  });

  it('accepts the leap day of a leap year', () => {
    const res = decodeWithMap(code('153', '24060'), NZ_MAP, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.decoded.productionDate).toBe('2024-02-29');
  });

  it('REFUSES a production date in the future or absurdly old', () => {
    expect(decodeWithMap(code('153', '35001'), NZ_MAP, NOW).ok).toBe(false); // 2035
    expect(decodeWithMap(code('153', '10001'), NZ_MAP, NOW).ok).toBe(false); // 2010
  });

  it('REFUSES a barcode of the wrong length or prefix for the map', () => {
    expect(decodeWithMap(BRISKET.slice(0, 19), NZ_MAP, NOW).ok).toBe(false);
    expect(decodeWithMap(`3${BRISKET.slice(1)}`, NZ_MAP, NOW).ok).toBe(false);
  });

  it('REFUSES non-numeric weight digits', () => {
    expect(decodeWithMap('207800AB324068137124', NZ_MAP, NOW).ok).toBe(false);
  });

  it('REFUSES a map whose weight field runs past the end of the barcode', () => {
    const bad: BarcodeFormatMap = {
      ...NZ_MAP,
      fields: { ...NZ_MAP.fields, netWeight: { ...NZ_MAP.fields.netWeight!, start: 18, length: 6 } },
    };
    expect(decodeWithMap(BRISKET, bad, NOW).ok).toBe(false);
  });
});

describe('validateProposedMap — nothing is saved on the AI’s word alone', () => {
  it('accepts a map that reproduces the printed values from the real scan', () => {
    const res = validateProposedMap(NZ_MAP, BRISKET, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.decoded.weightKg).toBeCloseTo(15.3, 3);
  });

  it('rejects when the AI says the weight did NOT match the printed label', () => {
    const map = { ...NZ_MAP, verification: { ...NZ_MAP.verification, weightMatchesPrinted: false } };
    const res = validateProposedMap(map, BRISKET, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/reproduce the printed weight/);
  });

  it('rejects a low-confidence weight field', () => {
    const map: BarcodeFormatMap = {
      ...NZ_MAP,
      fields: { ...NZ_MAP.fields, netWeight: { ...NZ_MAP.fields.netWeight!, confidence: 0.4 } },
    };
    const res = validateProposedMap(map, BRISKET, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Confidence/);
  });

  it('rejects a map with no weight field at all', () => {
    const map: BarcodeFormatMap = { ...NZ_MAP, fields: { ...NZ_MAP.fields, netWeight: null } };
    expect(validateProposedMap(map, BRISKET, NOW).ok).toBe(false);
  });

  it('rejects a map whose claimed length disagrees with the scanned barcode', () => {
    const map: BarcodeFormatMap = { ...NZ_MAP, signature: { length: 18, prefix: '2', prefixLength: 1 } };
    expect(validateProposedMap(map, BRISKET, NOW).ok).toBe(false);
  });

  it('IGNORES a true weightMatchesPrinted flag when the digits disagree', () => {
    // The AI claims success but points the weight field at the serial: the
    // in-code re-decode produces an out-of-range weight and refuses.
    const lying: BarcodeFormatMap = {
      ...NZ_MAP,
      fields: { ...NZ_MAP.fields, netWeight: { ...NZ_MAP.fields.netWeight!, start: 14, length: 3 } },
    };
    const res = validateProposedMap(lying, BRISKET, NOW); // digits "137" -> 13.7 kg
    // 13.7 kg is in range, so this particular lie survives the range check —
    // which is exactly why the human confirm screen exists. Prove the decode
    // reflects the SCANNED digits, not the AI's printed reading.
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.decoded.weightKg).toBeCloseTo(13.7, 3);
  });
});

describe('saved maps, lookup and ambiguity', () => {
  it('saves, lists and deletes a map (delete = relearn)', () => {
    const saved = saveBarcodeMap(NZ_MAP, BRISKET);
    expect(loadBarcodeMaps()).toHaveLength(1);
    expect(saved.sampleRaw).toBe(BRISKET);
    expect(saved.id).toBeTruthy();
    expect(removeBarcodeMap(saved.id)).toHaveLength(0);
  });

  it('decodes a later scan from the saved map, offline', () => {
    saveBarcodeMap(NZ_MAP, BRISKET);
    const out = decodeWithSavedMaps(code('227', '24100'), loadBarcodeMaps(), NOW);
    expect(out.kind).toBe('decoded');
    if (out.kind !== 'decoded') return;
    expect(out.decoded.weightKg).toBeCloseTo(22.7, 3);
  });

  it('reports no match for a barcode no saved map claims', () => {
    saveBarcodeMap(NZ_MAP, BRISKET);
    expect(decodeWithSavedMaps('123456', loadBarcodeMaps(), NOW).kind).toBe('none');
  });

  it('surfaces an invalid decode with its reason rather than counting it', () => {
    saveBarcodeMap(NZ_MAP, BRISKET);
    const out = decodeWithSavedMaps(code('999'), loadBarcodeMaps(), NOW);
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') expect(out.reason).toMatch(/outside/);
  });

  it('NEVER guesses between two maps that could both claim the barcode', () => {
    saveBarcodeMap(NZ_MAP, BRISKET);
    saveBarcodeMap({ ...NZ_MAP, formatName: 'Another 20-digit format' }, BRISKET);
    const out = decodeWithSavedMaps(BRISKET, loadBarcodeMaps(), NOW);
    expect(out.kind).toBe('ambiguous');
    if (out.kind === 'ambiguous') expect(out.maps).toHaveLength(2);
  });

  it('distinguishes formats by signature prefix', () => {
    saveBarcodeMap(NZ_MAP, BRISKET); // prefix "2"
    saveBarcodeMap({ ...NZ_MAP, formatName: 'Other plant', signature: { length: 20, prefix: '9', prefixLength: 1 } }, BRISKET);
    const out = decodeWithSavedMaps(BRISKET, loadBarcodeMaps(), NOW);
    expect(out.kind).toBe('decoded'); // only the "2" map claims it
  });
});

describe('per-session confirmation', () => {
  it('a map needs one human confirmation per app run', () => {
    const saved = saveBarcodeMap(NZ_MAP, BRISKET);
    expect(isMapConfirmedThisSession(saved.id)).toBe(false);
    markMapConfirmed(saved.id);
    expect(isMapConfirmedThisSession(saved.id)).toBe(true);
    resetSessionConfirmations(); // simulates a fresh app launch
    expect(isMapConfirmedThisSession(saved.id)).toBe(false);
  });
});
