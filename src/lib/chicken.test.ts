// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseGS1 } from './gs1';
import {
  chickenByProduct,
  chickenTotalKg,
  entryFromPack,
  entryKg,
  getChickenPack,
  loadChickenPacks,
  loadSavedChickenCounts,
  materializeEntries,
  removeChickenPack,
  removeSavedChickenCount,
  resolveChickenScan,
  saveChickenCount,
  upsertChickenPack,
  type ChickenEntry,
  type ChickenPackProfile,
} from './chicken';

/** Real labels photographed on the dock. */
const LABELS = {
  /** Van den Brink whole bag — RANDOM weight: AI 3102 = 8.73 kg. */
  vdbRandom: '(01)99420053912725(11)260717(15)260729(3102)000873(21)134258',
  /** Van den Brink tenderloins — weight in barcode: 12.21 kg. */
  vdbTenderloin: '(01)19420053906667(11)260715(15)260729(3102)001221(21)545372',
  /** Ingham/PPH thigh fillet — SET weight: GTIN + use-by only, no weight AI. */
  inghamThigh: '(01)19414735674029(17)260727',
  /** Ingham/PPH wings — set weight. */
  inghamWings: '(01)19414735575524(17)260728',
  /** The Lot ID barcode also printed on the Ingham label (not GS1). */
  lotId: '4619700198',
};

const wingsProfile: ChickenPackProfile = {
  gtin: '19414735575524',
  product: 'FS FDSERV WINGS 10KG',
  type: 'set',
  packKg: 10,
  updatedAt: 'now',
};

beforeEach(() => localStorage.clear());

describe('resolveChickenScan — random-weight labels', () => {
  it('counts straight from the barcode, capturing dates and serial', () => {
    const out = resolveChickenScan(parseGS1(LABELS.vdbRandom), [], {});
    expect(out.kind).toBe('counted');
    if (out.kind !== 'counted') return;
    expect(out.entry).toMatchObject({
      gtin: '99420053912725',
      weightKg: 8.73,
      weightSource: 'barcode',
      productionDate: '2026-07-17',
      bestBefore: '2026-07-29',
      serial: '134258',
    });
  });

  it('never asks for a pack weight when the barcode carries one', () => {
    expect(resolveChickenScan(parseGS1(LABELS.vdbTenderloin), [], {}).kind).toBe('counted');
  });

  it('rejects a second scan of the same serialised carton', () => {
    const first = resolveChickenScan(parseGS1(LABELS.vdbRandom), [], {});
    if (first.kind !== 'counted') throw new Error('expected counted');
    const again = resolveChickenScan(parseGS1(LABELS.vdbRandom), [first.entry], {});
    expect(again).toEqual({ kind: 'duplicate', serial: '134258' });
  });
});

describe('resolveChickenScan — set-weight labels', () => {
  it('asks for the set weight the first time it sees the product', () => {
    const out = resolveChickenScan(parseGS1(LABELS.inghamWings), [], {});
    expect(out.kind).toBe('needs-pack');
    if (out.kind !== 'needs-pack') return;
    expect(out.gtin).toBe('19414735575524');
  });

  it('COUNTS THE CARTON once taught — a set entry, kg derived not captured', () => {
    upsertChickenPack(wingsProfile);
    const out = resolveChickenScan(parseGS1(LABELS.inghamWings), []);
    expect(out.kind).toBe('counted');
    if (out.kind !== 'counted') return;
    expect(out.entry).toMatchObject({
      product: 'FS FDSERV WINGS 10KG',
      weightSource: 'set',
      useBy: '2026-07-28',
    });
    expect(entryKg(out.entry)).toBe(10);
  });

  it('honours a deliberate count-only product (no kg)', () => {
    upsertChickenPack({ gtin: '19414735674029', product: 'Thigh fillet', type: 'set', packKg: null, updatedAt: 'now' });
    const out = resolveChickenScan(parseGS1(LABELS.inghamThigh), []);
    if (out.kind !== 'counted') throw new Error('expected counted');
    expect(out.entry.weightSource).toBe('set');
    expect(entryKg(out.entry)).toBe(0);
  });

  it('stays repeatable — identical set-weight cartons must all count', () => {
    upsertChickenPack(wingsProfile);
    const parsed = parseGS1(LABELS.inghamWings);
    const a = resolveChickenScan(parsed, []);
    if (a.kind !== 'counted') throw new Error('expected counted');
    // Same barcode again (a different physical carton — no serial to tell apart)
    const b = resolveChickenScan(parsed, [a.entry]);
    expect(b.kind).toBe('counted');
  });

  it("the user's SET choice wins even if the barcode carries a weight", () => {
    // Taught as set-weight; the tenderloin barcode happens to carry 12.21 kg.
    const packs: Record<string, ChickenPackProfile> = {
      '19420053906667': { gtin: '19420053906667', product: 'Tenderloins 12kg', type: 'set', packKg: 12, updatedAt: 'now' },
    };
    const out = resolveChickenScan(parseGS1(LABELS.vdbTenderloin), [], packs);
    if (out.kind !== 'counted') throw new Error('expected counted');
    expect(out.entry.weightSource).toBe('set');
    expect(entryKg(out.entry, packs)).toBe(12);
  });

  it('a random profile whose barcode has no weight re-prompts (self-heals)', () => {
    const packs: Record<string, ChickenPackProfile> = {
      '19414735575524': { gtin: '19414735575524', product: 'Wings', type: 'random', packKg: null, updatedAt: 'now' },
    };
    expect(resolveChickenScan(parseGS1(LABELS.inghamWings), [], packs).kind).toBe('needs-pack');
  });
});

describe('resolveChickenScan — wrong barcode on the label', () => {
  it('rejects the Lot ID barcode (no GTIN)', () => {
    expect(resolveChickenScan(parseGS1(LABELS.lotId), [], {})).toEqual({ kind: 'not-gs1' });
  });
});

describe('derived totals — cartons × set weight', () => {
  const entry = (over: Partial<ChickenEntry>): ChickenEntry => ({
    id: Math.random().toString(36).slice(2),
    time: '2026-07-20T00:00:00.000Z',
    gtin: 'g1',
    product: 'P1',
    weightKg: 10,
    weightSource: 'set',
    raw: '',
    ...over,
  });
  const setPacks: Record<string, ChickenPackProfile> = {
    g1: { gtin: 'g1', product: 'P1', type: 'set', packKg: 10, updatedAt: 'now' },
  };

  it('totals mixed set- and random-weight cartons', () => {
    expect(
      chickenTotalKg([entry({}), entry({ gtin: 'g2', weightKg: 8.73, weightSource: 'barcode' })], setPacks),
    ).toBeCloseTo(18.73, 2);
  });

  it('DERIVES set kg from the current profile — editing the set weight updates totals', () => {
    const entries = [entry({}), entry({})]; // snapshots say 10
    expect(chickenTotalKg(entries, setPacks)).toBe(20);
    const edited: Record<string, ChickenPackProfile> = {
      g1: { ...setPacks.g1, packKg: 12.5 },
    };
    expect(chickenTotalKg(entries, edited)).toBe(25); // 2 ctn × 12.5, snapshots ignored
  });

  it('falls back to the entry snapshot when the profile is gone', () => {
    expect(chickenTotalKg([entry({})], {})).toBe(10);
  });

  it('treats legacy pack/none entries as set entries', () => {
    const legacy = [
      entry({ weightSource: 'pack' as ChickenEntry['weightSource'] }),
      entry({ weightKg: 0, weightSource: 'none' as ChickenEntry['weightSource'], gtin: 'g9' }),
    ];
    expect(chickenTotalKg(legacy, setPacks)).toBe(10); // pack derives 10; none has no profile -> 0
  });

  it('groups per product: type, cartons primary, kg derived for set / summed for random', () => {
    const rows = chickenByProduct(
      [
        entry({ gtin: 'g1', product: 'Wings' }),
        entry({ gtin: 'g1', product: 'Wings' }),
        entry({ gtin: 'g2', product: 'Whole', weightKg: 8.73, weightSource: 'barcode' }),
      ],
      setPacks,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ product: 'Wings', type: 'set', cartons: 2, kg: 20, setKg: 10 });
    expect(rows[1]).toMatchObject({ product: 'Whole', type: 'random', cartons: 1, kg: 8.73, setKg: null });
  });

  it('counts count-only cartons without adding kg', () => {
    const rows = chickenByProduct([entry({ gtin: 'g3', weightKg: 0 })], {});
    expect(rows[0]).toMatchObject({ type: 'set', cartons: 1, kg: 0 });
  });

  it('materializeEntries bakes the derived kg in (stable saves/exports)', () => {
    const m = materializeEntries([entry({ weightKg: 999 })], setPacks);
    expect(m[0].weightKg).toBe(10);
  });
});

describe('pack profiles and saved counts', () => {
  it('learns, reads back and deletes a set weight (delete = relearn)', () => {
    upsertChickenPack(wingsProfile);
    expect(getChickenPack(wingsProfile.gtin)?.packKg).toBe(10);
    removeChickenPack(wingsProfile.gtin);
    expect(getChickenPack(wingsProfile.gtin)).toBeUndefined();
  });

  it('migrates first-release profiles that lack a type', () => {
    localStorage.setItem(
      'cw.chickenPacks',
      JSON.stringify({
        a: { gtin: 'a', product: 'Set thing', packKg: 10, updatedAt: 'now' },
        b: { gtin: 'b', product: 'Ambiguous', packKg: null, updatedAt: 'now' },
      }),
    );
    const packs = loadChickenPacks();
    expect(packs.a.type).toBe('set'); // a stored weight was only ever a set weight
    expect(packs.b.type).toBe('random'); // ambiguous -> random; a set line self-heals via re-prompt
  });

  it('saves counts materialized, to their own list apart from receival History', () => {
    upsertChickenPack(wingsProfile);
    const e = entryFromPack(parseGS1(LABELS.inghamWings), wingsProfile);
    const rec = saveChickenCount([e, e], 'Evan');
    expect(rec).toMatchObject({ cartons: 2, totalKg: 20, scannedBy: 'Evan' });
    expect(rec.entries[0].weightKg).toBe(10); // baked at save time
    expect(loadSavedChickenCounts()).toHaveLength(1);
    expect(localStorage.getItem('cw.chickenCounts')).toBeTruthy();
    expect(localStorage.getItem('cw.quickCounts')).toBeNull(); // never mixed
    expect(removeSavedChickenCount(rec.id)).toHaveLength(0);
  });

  it('a saved count is a stable record — later set-weight edits do not rewrite it', () => {
    upsertChickenPack(wingsProfile);
    const e = entryFromPack(parseGS1(LABELS.inghamWings), wingsProfile);
    const rec = saveChickenCount([e], 'Evan');
    upsertChickenPack({ ...wingsProfile, packKg: 99 });
    const stored = loadSavedChickenCounts()[0];
    expect(stored.id).toBe(rec.id);
    expect(stored.totalKg).toBe(10);
  });
});
