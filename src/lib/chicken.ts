/**
 * Fresh Chicken count — a standalone carton/weight tally for chicken barcodes,
 * outside the formal receival flow (like Quick Count, but capturing everything
 * the barcode offers).
 *
 * Two product types, chosen when teaching:
 *  - RANDOM weight (e.g. Van den Brink): weight varies per carton and the
 *    GS1-128 barcode carries it (AI 310n/320n). Each scan captures the
 *    carton's ACTUAL weight.
 *  - SET weight (e.g. Ingham/PPH "FS CKN"): every carton of the product is
 *    the same weight and the barcode carries none. Scanning COUNTS CARTONS;
 *    kg is DERIVED as cartons × the product's saved set weight. The set
 *    weight is entered once, lives on the GTIN profile, and editing it
 *    (Label Intelligence) updates derived totals for the active count.
 *    packKg = null means "count this product's cartons, no kg".
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
  /** Product name from the profile ('' if never taught/named). */
  product: string;
  /**
   * For 'barcode' entries: the carton's actual scanned weight (authoritative).
   * For 'set' entries: a fallback snapshot only — live totals DERIVE the kg
   * from the profile's current set weight (see entryKg), so an edited set
   * weight flows through; this snapshot covers a later-deleted profile.
   */
  weightKg: number;
  /**
   * 'barcode' = actual weight read from the barcode (random-weight product);
   * 'set' = counted carton of a set-weight product (kg derived from profile);
   * 'estimate' = un-scanned carton of a random-weight PALLET — records the
   * scanned carton's weight as an estimate (flagged in the export).
   * 'pack' / 'none' are legacy spellings of 'set' from the first release,
   * still present in stored counts — treated as 'set'.
   */
  weightSource: 'barcode' | 'set' | 'estimate' | 'pack' | 'none';
  productionDate?: string;
  bestBefore?: string;
  useBy?: string;
  batch?: string;
  serial?: string;
  raw: string;
}

/** Is this entry a set-weight carton (any spelling, incl. legacy)? Barcode
 *  and estimate entries belong to random-weight products. */
function isSetEntry(e: ChickenEntry): boolean {
  return e.weightSource !== 'barcode' && e.weightSource !== 'estimate';
}

/** Per-GTIN chicken product profile (the teach output). */
export interface ChickenPackProfile {
  gtin: string;
  product: string;
  /**
   * 'set': every carton identical — count cartons, derive kg from packKg.
   * 'random': weight varies per carton — each scan uses the barcode weight.
   */
  type: 'set' | 'random';
  /** Set weight per carton in kg ('set' only); null = count cartons, no kg. */
  packKg: number | null;
  updatedAt: string;
}

/** A chicken count saved to the device (entries materialized at save time). */
export interface SavedChickenCount {
  id: string;
  savedAt: string;
  scannedBy: string;
  cartons: number;
  totalKg: number;
  entries: ChickenEntry[];
}

// --- profiles ---------------------------------------------------------------

export function loadChickenPacks(): Record<string, ChickenPackProfile> {
  const all = loadJSON<Record<string, ChickenPackProfile>>(STORAGE_KEYS.chickenPacks, {});
  // First-release profiles carried no `type`. packKg != null was only ever a
  // set weight -> 'set'. A null packKg was ambiguous (random product, or
  // set count-only) -> 'random' self-heals: a set product re-prompts on its
  // next scan (no barcode weight -> needs-pack), a random one just works.
  for (const p of Object.values(all)) {
    p.type ??= p.packKg != null ? 'set' : 'random';
  }
  return all;
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

// --- derivation -------------------------------------------------------------

/**
 * An entry's kg contribution. Barcode entries carry their own (actual)
 * weight; set entries derive from the profile's CURRENT set weight so edits
 * flow through, falling back to the entry's snapshot if the profile is gone.
 */
export function entryKg(
  e: ChickenEntry,
  packs: Record<string, ChickenPackProfile> = loadChickenPacks(),
): number {
  if (!isSetEntry(e)) return e.weightKg;
  const p = packs[e.gtin];
  if (p && p.type === 'set') return p.packKg ?? 0;
  return e.weightKg ?? 0;
}

/** Total kg: actual weights + derived set-weight contributions. */
export function chickenTotalKg(
  entries: ChickenEntry[],
  packs: Record<string, ChickenPackProfile> = loadChickenPacks(),
): number {
  return roundKg(entries.reduce((sum, e) => sum + roundKg(entryKg(e, packs)), 0));
}

/**
 * Bake each entry's derived kg into weightKg. Used when a count leaves the
 * live-derivation world (saving, exporting) so the record is self-contained
 * and stable even if set weights are edited later.
 */
export function materializeEntries(
  entries: ChickenEntry[],
  packs: Record<string, ChickenPackProfile> = loadChickenPacks(),
): ChickenEntry[] {
  // Also backfill the product name for entries counted before their GTIN was
  // named, so a spreadsheet never shows "(unnamed)" once the name is known.
  return entries.map((e) => ({
    ...e,
    weightKg: roundKg(entryKg(e, packs)),
    product: e.product || packs[e.gtin]?.product || '',
  }));
}

export interface ChickenProductRow {
  gtin: string;
  product: string;
  type: 'set' | 'random';
  cartons: number;
  kg: number;
  /** The per-carton set weight ('set' rows; null = count-only). */
  setKg: number | null;
  /** Un-scanned pallet cartons whose kg is an estimate ('random' rows). */
  estimated: number;
}

/** Per-product breakdown (cartons primary, kg derived/summed), first-seen order. */
export function chickenByProduct(
  entries: ChickenEntry[],
  packs: Record<string, ChickenPackProfile> = loadChickenPacks(),
): ChickenProductRow[] {
  const map = new Map<string, ChickenProductRow>();
  for (const e of entries) {
    const set = isSetEntry(e);
    const p = packs[e.gtin];
    const row =
      map.get(e.gtin) ??
      {
        gtin: e.gtin,
        product: e.product,
        type: set ? ('set' as const) : ('random' as const),
        cartons: 0,
        kg: 0,
        setKg: set ? (p?.type === 'set' ? p.packKg : e.weightKg || null) : null,
        estimated: 0,
      };
    row.cartons += 1;
    if (e.weightSource === 'estimate') row.estimated += 1;
    row.kg = roundKg(row.kg + roundKg(entryKg(e, packs)));
    if (!row.product && e.product) row.product = e.product;
    map.set(e.gtin, row);
  }
  const rows = [...map.values()];
  // Entries counted before their GTIN was named pick the name up from the
  // profile, so the breakdown (and Summary sheet) never shows unnamed rows
  // once the product has been taught.
  for (const row of rows) {
    if (!row.product) row.product = packs[row.gtin]?.product ?? '';
  }
  return rows;
}

// --- saved counts -----------------------------------------------------------

export function loadSavedChickenCounts(): SavedChickenCount[] {
  return loadJSON<SavedChickenCount[]>(STORAGE_KEYS.chickenCounts, []);
}

export function saveChickenCount(entries: ChickenEntry[], scannedBy: string): SavedChickenCount {
  const packs = loadChickenPacks();
  const materialized = materializeEntries(entries, packs);
  const record: SavedChickenCount = {
    id: uid(),
    savedAt: new Date().toISOString(),
    scannedBy,
    cartons: materialized.length,
    totalKg: chickenTotalKg(materialized, packs),
    entries: materialized,
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
  | { kind: 'needs-name'; parsed: ParsedCarton; gtin: string }
  | { kind: 'counted'; entry: ChickenEntry };

/**
 * Decide what a scanned chicken barcode should do. Pure — the caller owns
 * state. Rules, in order:
 *  - no GTIN -> not a GS1 carton barcode (these labels also carry a Lot ID
 *    and an internal code; only the (01)… one counts);
 *  - a serial (AI 21) already counted -> duplicate carton;
 *  - taught 'set' product -> COUNT THE CARTON (kg derives from the profile;
 *    the user's choice wins even if the barcode happened to carry a weight);
 *  - weight in the barcode + a NAMED profile -> actual weight, counts
 *    straight away (random);
 *  - weight in the barcode, no name known -> ask for the product name once
 *    (nothing may count unnamed — "(unnamed)" on a spreadsheet is a defect);
 *  - otherwise -> unknown set-weight product: ask for its set weight once.
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

  const pack = packs[gtin];

  // An unnamed set profile (first release allowed it) re-prompts below so the
  // name gets captured; a named one counts.
  if (pack?.type === 'set' && pack.product) {
    return { kind: 'counted', entry: entryFromPack(parsed, pack) };
  }

  if (parsed.weightKg != null) {
    if (!pack?.product) return { kind: 'needs-name', parsed, gtin };
    const base = entryBase(parsed, gtin);
    return {
      kind: 'counted',
      entry: { ...base, product: pack.product, weightKg: parsed.weightKg, weightSource: 'barcode' },
    };
  }

  // 'random' profile but no weight in this barcode -> the type is wrong for
  // this label; re-prompt so it self-corrects (same path as unknown).
  return { kind: 'needs-pack', parsed, gtin };
}

function entryBase(parsed: ParsedCarton, gtin: string) {
  return {
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
}

/** Build a counted carton of a set-weight product. */
export function entryFromPack(parsed: ParsedCarton, pack: ChickenPackProfile): ChickenEntry {
  return {
    ...entryBase(parsed, pack.gtin),
    product: pack.product,
    // Snapshot only — live totals derive from the profile (see entryKg).
    weightKg: pack.packKg ?? 0,
    weightSource: 'set',
  };
}

/**
 * A whole pallet of one product: scan ONE carton, type the pallet's carton
 * count — this builds the (count − 1) additional entries. Copies keep the
 * product/dates/batch but drop the serial and raw barcode (those belong to
 * the physically scanned carton, and a copied serial would trip the duplicate
 * check). A random-weight copy records the scanned carton's weight as an
 * ESTIMATE (flagged in the export); set-weight copies count and derive like
 * any other set carton.
 */
export function palletCopies(scanned: ChickenEntry, palletCartons: number): ChickenEntry[] {
  const copies: ChickenEntry[] = [];
  for (let i = 1; i < palletCartons; i++) {
    copies.push({
      ...scanned,
      id: uid(),
      serial: undefined,
      raw: '',
      weightSource: scanned.weightSource === 'barcode' ? 'estimate' : scanned.weightSource,
    });
  }
  return copies;
}

// --- export -----------------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** How a carton's kg was arrived at — spelled out so a reader of the sheet
 *  knows which weights were actually weighed vs counted-as-nominal. */
function sourceLabel(e: ChickenEntry): string {
  if (e.weightSource === 'barcode') return 'Actual (from barcode)';
  if (e.weightSource === 'estimate') return 'Estimated (pallet — copied from scanned carton)';
  return 'Nominal (set weight)';
}

/** The stock-rotation date a carton's barcode carries: best-before / use-by
 *  (whichever the label prints), falling back to production date. */
function rotationDate(e: ChickenEntry): string | undefined {
  return e.bestBefore ?? e.useBy ?? e.productionDate;
}

/** Exported for tests — the app goes through exportChickenCount. */
export function buildChickenWorkbook(
  XLSX: typeof XLSXType,
  entries: ChickenEntry[],
  meta: { scannedBy: string; when: string },
): XLSXType.WorkBook {
  // Entries are expected pre-materialized (weightKg final).
  const rows = chickenByProduct(entries, {});

  // Sheet 1 — Summary: ONE line per product. The total is the figure that
  // matters for the line: carton count for set weight, kg for random weight.
  const summary: (string | number)[][] = [
    ['Fresh Chicken count (carton tally — not a formal receival)'],
    ['Counted by', meta.scannedBy || '—'],
    ['Date/time', formatDateTime(meta.when)],
    ['Dates are the best-before / use-by from the barcodes'],
    [],
    ['Vendor item code', 'Description', 'Total', 'Unit', 'Earliest date', 'Latest date'],
  ];
  for (const r of rows) {
    const dates = entries
      .filter((e) => e.gtin === r.gtin)
      .map(rotationDate)
      .filter((d): d is string => !!d)
      .sort();
    summary.push([
      r.gtin,
      r.product || '(unnamed)',
      r.type === 'set' ? r.cartons : r.kg,
      r.type === 'set'
        ? 'cartons (set weight)'
        : r.estimated > 0
          ? `kg (random weight — ${r.estimated} of ${r.cartons} ctn estimated)`
          : 'kg (random weight)',
      dates[0] ?? '',
      dates[dates.length - 1] ?? '',
    ]);
  }
  summary.push([]);
  summary.push(['TOTAL', '', entries.length, 'cartons', '', '']);
  summary.push(['', '', chickenTotalKg(entries, {}), 'kg', '', '']);
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 10 }, { wch: 20 }, { wch: 13 }, { wch: 13 }];

  // Sheet 2 — Cartons: line by line, arranged in product order (the order the
  // products appear on the Summary), scan order within a product.
  const order = new Map(rows.map((r, i) => [r.gtin, i]));
  const sorted = entries
    .slice()
    .sort(
      (a, b) =>
        (order.get(a.gtin) ?? 0) - (order.get(b.gtin) ?? 0) ||
        (a.time < b.time ? -1 : a.time > b.time ? 1 : 0),
    );
  const cartons: (string | number)[][] = [
    ['#', 'Time', 'Product', 'Type', 'GTIN', 'Weight (kg)', 'Weight basis', 'Production date', 'Best before', 'Use by', 'Batch/Lot', 'Serial', 'Raw barcode'],
  ];
  sorted.forEach((e, i) => {
    cartons.push([
      i + 1,
      formatDateTime(e.time),
      e.product || '',
      isSetEntry(e) ? 'Set' : 'Random',
      e.gtin,
      roundKg(e.weightKg),
      sourceLabel(e),
      e.productionDate ?? '',
      e.bestBefore ?? '',
      e.useBy ?? '',
      e.batch ?? '',
      e.serial ?? '',
      e.raw.replace(/\x1d/g, '{GS}'),
    ]);
  });
  cartons.push([]);
  cartons.push(['TOTAL', '', '', '', `${entries.length} carton${entries.length === 1 ? '' : 's'}`, chickenTotalKg(entries, {})]);
  const wsCartons = XLSX.utils.aoa_to_sheet(cartons);
  wsCartons['!cols'] = [
    { wch: 5 }, { wch: 20 }, { wch: 26 }, { wch: 8 }, { wch: 16 }, { wch: 11 }, { wch: 20 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 40 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  XLSX.utils.book_append_sheet(wb, wsCartons, 'Cartons');
  return wb;
}

/** Warm the xlsx chunk so the share call keeps the iOS user gesture. */
export function preloadXlsx(): void {
  void import('xlsx').catch(() => {});
}

/**
 * Export a count. Entries must already be materialized (saved counts are;
 * for the ACTIVE count pass materializeEntries(entries) so exports are
 * stable snapshots, not re-derived from whatever the profiles say later).
 */
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
