/**
 * Fresh Chicken count — a standalone carton/weight tally for chicken barcodes,
 * outside the formal receival flow (like Quick Count, but capturing everything
 * the barcode offers).
 *
 * Two label families in the field:
 *  - RANDOM weight (e.g. Van den Brink): full GS1-128 carrying a net weight
 *    AI (310n/320n) — the weight comes straight off the barcode.
 *  - SET weight (e.g. Ingham/PPH "FS CKN"): GS1-128 with GTIN + use-by ONLY,
 *    no weight AI at all. The carton weight is LEARNED once per GTIN (the
 *    printed pack size, e.g. 10 kg) and auto-applied to every later scan.
 *
 * A pack profile may deliberately carry packKg = null, meaning "count this
 * product's cartons but don't add kg".
 */

import type * as XLSXType from 'xlsx';
import type { ParsedCarton } from './gs1';
import { STORAGE_KEYS, loadJSON, saveJSON, uid } from './storage';
import { fileStamp, shareOrDownloadFile, XLSX_MIME, type ShareResult } from './shareFile';
import { roundKg } from './units';

/** One counted chicken carton, with everything its barcode carried. */
export interface ChickenEntry {
  id: string;
  time: string;
  gtin: string;
  /** Product name from the learned pack profile ('' if never named). */
  product: string;
  /** Net kg counted (0 when the product is deliberately count-only). */
  weightKg: number;
  /** Where the weight came from — the barcode itself, a learned pack weight,
   *  or 'none' for a count-only product. */
  weightSource: 'barcode' | 'pack' | 'none';
  productionDate?: string;
  bestBefore?: string;
  useBy?: string;
  batch?: string;
  serial?: string;
  raw: string;
}

/** Learned per-GTIN carton weight for set-weight lines. */
export interface ChickenPackProfile {
  gtin: string;
  product: string;
  /** Carton weight in kg, or null for "count cartons only, no kg". */
  packKg: number | null;
  updatedAt: string;
}

/** A chicken count saved to the device. */
export interface SavedChickenCount {
  id: string;
  savedAt: string;
  scannedBy: string;
  cartons: number;
  totalKg: number;
  entries: ChickenEntry[];
}

export function chickenTotalKg(entries: ChickenEntry[]): number {
  return roundKg(entries.reduce((sum, e) => sum + roundKg(e.weightKg), 0));
}

/** Per-product breakdown (cartons + kg), in first-seen order. */
export function chickenByProduct(
  entries: ChickenEntry[],
): Array<{ gtin: string; product: string; cartons: number; kg: number }> {
  const map = new Map<string, { gtin: string; product: string; cartons: number; kg: number }>();
  for (const e of entries) {
    const row = map.get(e.gtin) ?? { gtin: e.gtin, product: e.product, cartons: 0, kg: 0 };
    row.cartons += 1;
    row.kg = roundKg(row.kg + roundKg(e.weightKg));
    if (!row.product && e.product) row.product = e.product;
    map.set(e.gtin, row);
  }
  return [...map.values()];
}

// --- learned pack weights ---------------------------------------------------

export function loadChickenPacks(): Record<string, ChickenPackProfile> {
  return loadJSON<Record<string, ChickenPackProfile>>(STORAGE_KEYS.chickenPacks, {});
}

export function getChickenPack(gtin: string): ChickenPackProfile | undefined {
  return loadChickenPacks()[gtin];
}

export function upsertChickenPack(profile: ChickenPackProfile): Record<string, ChickenPackProfile> {
  const all = loadChickenPacks();
  all[profile.gtin] = profile;
  saveJSON(STORAGE_KEYS.chickenPacks, all);
  return all;
}

export function removeChickenPack(gtin: string): Record<string, ChickenPackProfile> {
  const all = loadChickenPacks();
  delete all[gtin];
  saveJSON(STORAGE_KEYS.chickenPacks, all);
  return all;
}

// --- saved counts -----------------------------------------------------------

export function loadSavedChickenCounts(): SavedChickenCount[] {
  return loadJSON<SavedChickenCount[]>(STORAGE_KEYS.chickenCounts, []);
}

export function saveChickenCount(entries: ChickenEntry[], scannedBy: string): SavedChickenCount {
  const record: SavedChickenCount = {
    id: uid(),
    savedAt: new Date().toISOString(),
    scannedBy,
    cartons: entries.length,
    totalKg: chickenTotalKg(entries),
    entries,
  };
  saveJSON(STORAGE_KEYS.chickenCounts, [record, ...loadSavedChickenCounts()]);
  return record;
}

export function removeSavedChickenCount(id: string): SavedChickenCount[] {
  const rest = loadSavedChickenCounts().filter((c) => c.id !== id);
  saveJSON(STORAGE_KEYS.chickenCounts, rest);
  return rest;
}

// --- scanning ---------------------------------------------------------------

export type ScanOutcome =
  | { kind: 'not-gs1' }
  | { kind: 'duplicate'; serial: string }
  | { kind: 'needs-pack'; parsed: ParsedCarton; gtin: string }
  | { kind: 'counted'; entry: ChickenEntry };

/**
 * Decide what a scanned chicken barcode should do. Pure — the caller owns
 * state. Rules:
 *  - no GTIN -> not a GS1 carton barcode (these labels also carry a Lot ID
 *    and an internal code; only the (01)… one counts);
 *  - a serial (AI 21) that's already counted -> duplicate carton;
 *  - weight in the barcode -> count it straight away (random weight);
 *  - no weight + known pack profile -> count at the learned weight;
 *  - no weight + unknown GTIN -> ask for the pack weight once.
 */
export function resolveChickenScan(
  parsed: ParsedCarton,
  existing: ChickenEntry[],
  packs: Record<string, ChickenPackProfile> = loadChickenPacks(),
): ScanOutcome {
  const gtin = parsed.gtin;
  if (!gtin) return { kind: 'not-gs1' };

  // Serial'd cartons are unique; set-weight cartons share an identical
  // barcode across the whole line, so they must stay repeatable.
  if (parsed.serial && existing.some((e) => e.serial === parsed.serial && e.gtin === gtin)) {
    return { kind: 'duplicate', serial: parsed.serial };
  }

  const base = {
    id: uid(),
    time: new Date().toISOString(),
    gtin,
    productionDate: parsed.productionDate,
    bestBefore: parsed.bestBefore,
    useBy: parsed.useBy,
    batch: parsed.batch,
    serial: parsed.serial,
    raw: parsed.raw,
  };

  if (parsed.weightKg != null) {
    return {
      kind: 'counted',
      entry: { ...base, product: packs[gtin]?.product ?? '', weightKg: parsed.weightKg, weightSource: 'barcode' },
    };
  }

  const pack = packs[gtin];
  if (!pack) return { kind: 'needs-pack', parsed, gtin };

  return {
    kind: 'counted',
    entry: {
      ...base,
      product: pack.product,
      weightKg: pack.packKg ?? 0,
      weightSource: pack.packKg == null ? 'none' : 'pack',
    },
  };
}

/** Build a counted entry once a pack weight has just been supplied. */
export function entryFromPack(parsed: ParsedCarton, pack: ChickenPackProfile): ChickenEntry {
  return {
    id: uid(),
    time: new Date().toISOString(),
    gtin: pack.gtin,
    product: pack.product,
    weightKg: pack.packKg ?? 0,
    weightSource: pack.packKg == null ? 'none' : 'pack',
    productionDate: parsed.productionDate,
    bestBefore: parsed.bestBefore,
    useBy: parsed.useBy,
    batch: parsed.batch,
    serial: parsed.serial,
    raw: parsed.raw,
  };
}

// --- export -----------------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const SOURCE_LABEL: Record<ChickenEntry['weightSource'], string> = {
  barcode: 'Barcode (random)',
  pack: 'Pack weight (set)',
  none: 'Count only',
};

function buildChickenWorkbook(
  XLSX: typeof XLSXType,
  entries: ChickenEntry[],
  meta: { scannedBy: string; when: string },
): XLSXType.WorkBook {
  const cartons: (string | number)[][] = [
    ['#', 'Time', 'Product', 'GTIN', 'Weight (kg)', 'Weight source', 'Production date', 'Best before', 'Use by', 'Batch/Lot', 'Serial', 'Raw barcode'],
  ];
  entries.forEach((e, i) => {
    cartons.push([
      i + 1,
      formatDateTime(e.time),
      e.product || '',
      e.gtin,
      roundKg(e.weightKg),
      SOURCE_LABEL[e.weightSource],
      e.productionDate ?? '',
      e.bestBefore ?? '',
      e.useBy ?? '',
      e.batch ?? '',
      e.serial ?? '',
      e.raw.replace(/\x1d/g, '{GS}'),
    ]);
  });
  cartons.push([]);
  cartons.push(['TOTAL', '', '', `${entries.length} carton${entries.length === 1 ? '' : 's'}`, chickenTotalKg(entries)]);
  const wsCartons = XLSX.utils.aoa_to_sheet(cartons);
  wsCartons['!cols'] = [
    { wch: 5 }, { wch: 20 }, { wch: 26 }, { wch: 16 }, { wch: 11 }, { wch: 18 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 40 },
  ];

  const summary: (string | number)[][] = [
    ['Fresh Chicken count (carton tally — not a formal receival)'],
    ['Counted by', meta.scannedBy || '—'],
    ['Date/time', formatDateTime(meta.when)],
    [],
    ['Product', 'GTIN', 'Cartons', 'Weight (kg)'],
  ];
  for (const row of chickenByProduct(entries)) {
    summary.push([row.product || '(unnamed)', row.gtin, row.cartons, row.kg]);
  }
  summary.push([]);
  summary.push(['TOTAL', '', entries.length, chickenTotalKg(entries)]);
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 10 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsCartons, 'Cartons');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  return wb;
}

/** Warm the xlsx chunk so the share call keeps the iOS user gesture. */
export function preloadXlsx(): void {
  void import('xlsx').catch(() => {});
}

export async function exportChickenCount(
  entries: ChickenEntry[],
  meta: { scannedBy: string; when: string },
): Promise<ShareResult> {
  const XLSX = await import('xlsx');
  const wb = buildChickenWorkbook(XLSX, entries, meta);
  const array = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([array], { type: XLSX_MIME });
  return shareOrDownloadFile(blob, `chickencount_${fileStamp(meta.when)}.xlsx`);
}
