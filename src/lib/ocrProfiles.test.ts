// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadOcrProfiles,
  upsertOcrProfile,
  removeOcrProfile,
  findTaughtProfile,
  findProfileForCapture,
  taughtFormatHint,
  type OcrLabelProfile,
  type TaughtLabelMap,
} from './ocrProfiles';

const map = (over: Partial<TaughtLabelMap> = {}): TaughtLabelMap => ({
  unit: 'kg',
  decimalPlaces: 3,
  weightRegion: 'bottom-right',
  anchorText: 'NET WEIGHT',
  barcodeType: 'gs1-128-weight',
  dateFormats: [],
  batchPresent: true,
  serialPresent: false,
  aiFields: [],
  taughtAt: '2026-07-05T00:00:00.000Z',
  ...over,
});

const profile = (name: string, over: Partial<OcrLabelProfile> = {}): OcrLabelProfile => ({
  id: `id-${name}`,
  name,
  updatedAt: '2026-07-05T00:00:00.000Z',
  data: map(),
  ...over,
});

beforeEach(() => localStorage.clear());

describe('upsertOcrProfile', () => {
  it('creates then lists a profile', () => {
    upsertOcrProfile(profile('Fribin Meats S.L.'));
    expect(loadOcrProfiles()).toHaveLength(1);
  });

  it('re-teaching the same name replaces instead of duplicating (case-insensitive)', () => {
    upsertOcrProfile(profile('Fribin Meats S.L.'));
    upsertOcrProfile(profile('FRIBIN MEATS s.l.', { data: map({ unit: 'lb' }) }));
    const all = loadOcrProfiles();
    expect(all).toHaveLength(1);
    expect(all[0].data?.unit).toBe('lb');
    expect(all[0].id).toBe('id-Fribin Meats S.L.'); // keeps the original id
  });

  it('different suppliers coexist and delete works', () => {
    upsertOcrProfiles(['Fribin', 'Danish Crown']);
    expect(loadOcrProfiles()).toHaveLength(2);
    const fribin = loadOcrProfiles().find((p) => p.name === 'Fribin')!;
    expect(removeOcrProfile(fribin.id)).toHaveLength(1);
  });
});

function upsertOcrProfiles(names: string[]) {
  for (const n of names) upsertOcrProfile(profile(n));
}

describe('findTaughtProfile', () => {
  it('matches the session supplier case-insensitively and by substring', () => {
    upsertOcrProfile(profile('Fribin Meats S.L.'));
    expect(findTaughtProfile('fribin meats s.l.')?.name).toBe('Fribin Meats S.L.');
    expect(findTaughtProfile('Fribin')?.name).toBe('Fribin Meats S.L.'); // session supplier is shorter
    expect(findTaughtProfile('Danish Crown')).toBeUndefined();
    expect(findTaughtProfile('')).toBeUndefined();
  });

  it('ignores profiles without taught data', () => {
    upsertOcrProfile(profile('Fribin', { data: undefined }));
    expect(findTaughtProfile('Fribin')).toBeUndefined();
  });

  it('matches on a shared distinctive token ("Ltd" vs "Limited" spellings)', () => {
    upsertOcrProfile(profile('Alliance Group Ltd'));
    expect(findTaughtProfile('Alliance Group Limited')?.name).toBe('Alliance Group Ltd');
  });

  it('generic company words alone never match', () => {
    upsertOcrProfile(profile('Silver Fern Farms'));
    expect(findTaughtProfile('Canterbury Farms')).toBeUndefined();
    expect(findTaughtProfile('NZ Meats Group Ltd')).toBeUndefined();
  });
});

describe('findProfileForCapture', () => {
  it('falls back to the session supplier when no barcode is known', () => {
    upsertOcrProfile(profile('Taylor Preston Limited'));
    expect(findProfileForCapture(undefined, 'Taylor Preston')?.name).toBe('Taylor Preston Limited');
  });

  it('resolves the manufacturer from the GTIN prefix ahead of the supplier', () => {
    // 9941822 = Silver Fern Farms in the seed table; the session supplier is a
    // distributor with its own (different) taught profile.
    upsertOcrProfile(profile('Silver Fern Farms'));
    upsertOcrProfile(profile('Acme Distribution', { id: 'id-acme' }));
    const hit = findProfileForCapture('99418220123456', 'Acme Distribution');
    expect(hit?.name).toBe('Silver Fern Farms');
  });

  it('returns undefined when nothing matches — OCR must stay gated', () => {
    upsertOcrProfile(profile('Fribin'));
    expect(findProfileForCapture('99999990000000', 'Danish Crown')).toBeUndefined();
  });
});

describe('taughtFormatHint', () => {
  it('summarises the taught format', () => {
    expect(taughtFormatHint(map())).toBe('kg · 3 dp · near “NET WEIGHT”');
  });

  it('degrades gracefully when little was taught', () => {
    expect(taughtFormatHint(map({ unit: null, decimalPlaces: null, anchorText: null }))).toBe(
      'taught layout',
    );
  });
});
