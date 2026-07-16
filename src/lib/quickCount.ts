/**
 * Quick Count — a fast weight-only tally OUTSIDE the formal inwards-goods
 * receival flow. No PO, no supplier, no product/pallet structure: just a flat
 * list of weights with a running total. Saved counts live in their OWN
 * on-device list (never mixed into receival History) and export as a single
 * flat sheet.
 */

import type * as XLSXType from 'xlsx';
import { STORAGE_KEYS, loadJSON, saveJSON, uid } from './storage';
import { roundKg, type WeightUnit } from './units';

/** One weight in a quick count (barcode-scanned or keyed). */
export interface QuickCountEntry {
  id: string;
  /** Value as entered/read, in `unit`. */
  netWeight: number;
  unit: WeightUnit;
  /** Normalised kg (what the total sums). */
  weightKg: number;
  /** How it was captured. */
  entry: 'scan' | 'manual';
  time: string;
}

/** A quick count saved to the device for later lookup / re-export. */
export interface SavedQuickCount {
  id: string;
  savedAt: string;
  scannedBy: string;
  count: number;
  totalKg: number;
  entries: QuickCountEntry[];
}

/** Running total in kg — sums the ROUNDED per-entry kg (matches export). */
export function quickCountTotalKg(entries: QuickCountEntry[]): number {
  return roundKg(entries.reduce((sum, e) => sum + roundKg(e.weightKg), 0));
}

// --- saved-count storage (separate from receival History) ------------------

export function loadSavedQuickCounts(): SavedQuickCount[] {
  return loadJSON<SavedQuickCount[]>(STORAGE_KEYS.quickCounts, []);
}

/** Persist the current entries as a new saved quick count (newest first). */
export function saveQuickCount(entries: QuickCountEntry[], scannedBy: string): SavedQuickCount {
  const record: SavedQuickCount = {
    id: uid(),
    savedAt: new Date().toISOString(),
    scannedBy,
    count: entries.length,
    totalKg: quickCountTotalKg(entries),
    entries,
  };
  saveJSON(STORAGE_KEYS.quickCounts, [record, ...loadSavedQuickCounts()]);
  return record;
}

export function removeSavedQuickCount(id: string): SavedQuickCount[] {
  const rest = loadSavedQuickCounts().filter((q) => q.id !== id);
  saveJSON(STORAGE_KEYS.quickCounts, rest);
  return rest;
}

// --- export (flat sheet) + share -------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const ENTRY_LABEL: Record<QuickCountEntry['entry'], string> = { scan: 'Scanned', manual: 'Manual' };

async function buildQuickCountWorkbook(
  XLSX: typeof XLSXType,
  entries: QuickCountEntry[],
  meta: { scannedBy: string; when: string },
): Promise<XLSXType.WorkBook> {
  const aoa: (string | number)[][] = [
    ['Quick Count (weight-only tally — not a formal receival)'],
    ['Counted by', meta.scannedBy || '—'],
    ['Date/time', formatDateTime(meta.when)],
    [],
    ['#', 'Time', 'Net weight', 'Unit', 'Weight (kg)', 'Entry'],
  ];
  entries.forEach((e, i) => {
    aoa.push([i + 1, formatDateTime(e.time), e.netWeight, e.unit, roundKg(e.weightKg), ENTRY_LABEL[e.entry]]);
  });
  aoa.push([]);
  aoa.push(['TOTAL', '', '', '', quickCountTotalKg(entries), `${entries.length} item${entries.length === 1 ? '' : 's'}`]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 12 }, { wch: 6 }, { wch: 12 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Quick Count');
  return wb;
}

function quickCountFilename(when: string): string {
  const d = new Date(when);
  const ts = Number.isNaN(d.getTime())
    ? 'count'
    : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(
        d.getHours(),
      ).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `quickcount_${ts}.xlsx`;
}

/** Warm the xlsx chunk so the share call has minimal async gap (iOS gesture). */
export function preloadXlsx(): void {
  void import('xlsx').catch(() => {});
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Build the flat-list workbook and hand it to the device share sheet
 * (Web Share Level 2 — the iOS mail/share action). Falls back to a plain
 * download where file sharing isn't available; 'cancelled' if the user
 * dismisses the share sheet.
 */
export async function exportQuickCount(
  entries: QuickCountEntry[],
  meta: { scannedBy: string; when: string },
): Promise<ShareResult> {
  const XLSX = await import('xlsx');
  const wb = await buildQuickCountWorkbook(XLSX, entries, meta);
  const array = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const filename = quickCountFilename(meta.when);
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = new Blob([array], { type });

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const file = new File([blob], filename, { type });
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Quick Count' });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // otherwise fall through to a download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
