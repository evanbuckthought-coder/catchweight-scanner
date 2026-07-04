import { describe, it, expect } from 'vitest';
import { extractTeachJson, validateTeachRequest, TEACH_MAX_IMAGE_BASE64 } from './teachShared';

const sampleResult = {
  supplier: { value: 'Fribin', confidence: 'high' },
  manufacturer: { value: null, confidence: 'low' },
  product: { value: 'Pork shoulder', confidence: 'high' },
  gtin: { value: '98411314000123', barcodeType: 'gs1-128-weight', confidence: 'medium' },
  weight: {
    printedExample: '21.652 kg',
    unit: 'kg',
    decimalPlaces: 3,
    region: 'bottom-right',
    anchorText: 'NET WEIGHT',
    confidence: 'high',
  },
  dates: [],
  batch: { value: null, confidence: 'low' },
  serial: { value: null, confidence: 'low' },
  notes: null,
};

describe('extractTeachJson', () => {
  it('parses plain JSON', () => {
    const r = extractTeachJson(JSON.stringify(sampleResult));
    expect(r.weight.unit).toBe('kg');
    expect(r.weight.decimalPlaces).toBe(3);
  });

  it('parses JSON inside a markdown fence', () => {
    const r = extractTeachJson('```json\n' + JSON.stringify(sampleResult) + '\n```');
    expect(r.supplier.value).toBe('Fribin');
  });

  it('parses JSON surrounded by prose', () => {
    const r = extractTeachJson('Here is the analysis:\n' + JSON.stringify(sampleResult) + '\nDone.');
    expect(r.gtin.barcodeType).toBe('gs1-128-weight');
  });

  it('throws on non-JSON text', () => {
    expect(() => extractTeachJson('sorry, I cannot analyse this image')).toThrow();
  });

  it('throws on JSON missing the expected fields', () => {
    expect(() => extractTeachJson('{"foo": 1}')).toThrow();
  });
});

describe('validateTeachRequest', () => {
  const good = { image: 'aGVsbG8=', mediaType: 'image/jpeg' };

  it('accepts a valid body (with and without hint)', () => {
    expect(validateTeachRequest(good)).toBeNull();
    expect(validateTeachRequest({ ...good, hint: 'weight bottom-right' })).toBeNull();
  });

  it('rejects a missing/empty image', () => {
    expect(validateTeachRequest({ mediaType: 'image/jpeg' })).toMatch(/image/i);
    expect(validateTeachRequest({ ...good, image: '' })).toMatch(/image/i);
  });

  it('rejects an oversized image before any AI call', () => {
    expect(
      validateTeachRequest({ ...good, image: 'A'.repeat(TEACH_MAX_IMAGE_BASE64 + 1) }),
    ).toMatch(/too large/i);
  });

  it('rejects a data: URL prefix (must be raw base64)', () => {
    expect(validateTeachRequest({ ...good, image: 'data:image/jpeg;base64,aGVsbG8=' })).toMatch(/base64/i);
  });

  it('rejects unsupported media types and oversized hints', () => {
    expect(validateTeachRequest({ ...good, mediaType: 'image/gif' })).toMatch(/type/i);
    expect(validateTeachRequest({ ...good, hint: 'x'.repeat(501) })).toMatch(/hint/i);
  });

  it('rejects non-object bodies', () => {
    expect(validateTeachRequest(null)).not.toBeNull();
    expect(validateTeachRequest('image')).not.toBeNull();
  });
});
