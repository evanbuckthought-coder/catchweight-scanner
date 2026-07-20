// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseGS1 } from './gs1';
import {
  chickenByProduct,
  chickenTotalKg,
  entryFromPack,
  getChickenPack,
  loadSavedChickenCounts,
  removeChickenPack,
  removeSavedChickenCount,
  resolveChickenScan,
  saveChickenCount,
  upsertChickenPack,
  type ChickenEntry,
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
  it('asks for the pack weight the first time it sees the product', () => {
    const out = resolveChickenScan(parseGS1(LABELS.inghamWings), [], {});
    expect(out.kind).toBe('needs-pack');
    if (out.kind !== 'needs-pack') return;
    expect(out.gtin).toBe('19414735575524');
  });

  it('auto-counts at the learned pack weight afterwards', () => {
    upsertChickenPack({
      gtin: '19414735575524',
      product: 'FS FDSERV WINGS 10KG',
      packKg: 10,
      updatedAt: 'now',
    });
    const out = resolveChickenScan(parseGS1(LABELS.inghamWings), []);
    expect(out.kind).toBe('counted');
    if (out.kind !== 'counted') return;
    expect(out.entry).toMatchObject({
      product: 'FS FDSERV WINGS 10KG',
      weightKg: 10,
      weightSource: 'pack',
      useBy: '2026-07-28',
    });
  });

  it('honours a deliberate count-only product (no kg)', () => {
    upsertChickenPack({ gtin: '19414735674029', product: 'Thigh fillet', packKg: null, updatedAt: 'now' });
    const out = resolveChickenScan(parseGS1(LABELS.inghamThigh), []);
    if (out.kind !== 'counted') throw new Error('expected counted');
    expect(out.entry.weightKg).toBe(0);
    expect(out.entry.weightSource).toBe('none');
  });

  it('stays repeatable — identical set-weight cartons must all count', () => {
    upsertChickenPack({ gtin: '19414735575524', product: 'Wings', packKg: 10, updatedAt: 'now' });
    const parsed = parseGS1(LABELS.inghamWings);
    const a = resolveChickenScan(parsed, []);
    if (a.kind !== 'counted') throw new Error('expected counted');
    // Same barcode again (a different physical carton — no serial to tell apart)
    const b = resolveChickenScan(parsed, [a.entry]);
    expect(b.kind).toBe('counted');
  });
});

describe('resolveChickenScan — wrong barcode on the label', () => {
  it('rejects the Lot ID barcode (no GTIN)', () => {
    expect(resolveChickenScan(parseGS1(LABELS.lotId), [], {})).toEqual({ kind: 'not-gs1' });
  });
});

describe('totals and grouping', () => {
  const entry = (over: Partial<ChickenEntry>): ChickenEntry => ({
    id: Math.random().toString(36).slice(2),
    time: '2026-07-20T00:00:00.000Z',
    gtin: 'g1',
    product: 'P1',
    weightKg: 10,
    weightSource: 'pack',
    raw: '',
    ...over,
  });

  it('totals mixed set- and random-weight cartons', () => {
    expect(chickenTotalKg([entry({}), entry({ weightKg: 8.73, weightSource: 'barcode' })])).toBeCloseTo(18.73, 2);
  });

  it('groups per product with cartons and kg', () => {
    const rows = chickenByProduct([
      entry({ gtin: 'g1', product: 'Wings' }),
      entry({ gtin: 'g1', product: 'Wings' }),
      entry({ gtin: 'g2', product: 'Whole', weightKg: 8.73, weightSource: 'barcode' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ product: 'Wings', cartons: 2, kg: 20 });
    expect(rows[1]).toMatchObject({ product: 'Whole', cartons: 1, kg: 8.73 });
  });

  it('counts count-only cartons without adding kg', () => {
    const rows = chickenByProduct([entry({ weightKg: 0, weightSource: 'none' })]);
    expect(rows[0]).toMatchObject({ cartons: 1, kg: 0 });
  });
});

describe('pack profiles and saved counts', () => {
  it('learns, reads back and deletes a pack weight (delete = relearn)', () => {
    upsertChickenPack({ gtin: 'g1', product: 'Wings', packKg: 10, updatedAt: 'now' });
    expect(getChickenPack('g1')?.packKg).toBe(10);
    removeChickenPack('g1');
    expect(getChickenPack('g1')).toBeUndefined();
  });

  it('saves counts to their own list, apart from receival History', () => {
    const e = entryFromPack(parseGS1(LABELS.inghamWings), {
      gtin: '19414735575524',
      product: 'Wings',
      packKg: 10,
      updatedAt: 'now',
    });
    const rec = saveChickenCount([e, e], 'Evan');
    expect(rec).toMatchObject({ cartons: 2, totalKg: 20, scannedBy: 'Evan' });
    expect(loadSavedChickenCounts()).toHaveLength(1);
    expect(localStorage.getItem('cw.chickenCounts')).toBeTruthy();
    expect(localStorage.getItem('cw.quickCounts')).toBeNull(); // never mixed
    expect(removeSavedChickenCount(rec.id)).toHaveLength(0);
  });
});
