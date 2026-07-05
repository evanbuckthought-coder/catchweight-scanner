/**
 * Supplier lookup by GTIN prefix.
 *
 * The barcode carries a GTIN but never a human-readable supplier name. GS1
 * company prefixes are globally assigned, so the leading digits of the GTIN
 * identify the brand owner. This is a *seed* table for the proof-of-loop; in a
 * real deployment this mapping would come from the GS1 prefix registry / SAP
 * vendor master, not a hard-coded list.
 *
 * Note: real GS1 company prefixes are variable length (7-10 digits). The seed
 * keys below are all 7 digits, which is enough to disambiguate our five test
 * suppliers. lookupSupplier() matches the longest prefix that the GTIN starts
 * with, so longer, more specific keys win if ever added.
 */

import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export interface SupplierSeed {
  prefix: string;
  name: string;
}

export const SUPPLIER_SEEDS: SupplierSeed[] = [
  { prefix: '9842094', name: 'Fribin Foods (ES)' },
  { prefix: '9942002', name: 'Davmet NZ' },
  { prefix: '9933221', name: 'Teys Australia' },
  { prefix: '9941822', name: 'Silver Fern Farms' },
  { prefix: '9007024', name: 'Smithfield (US)' },
];

/**
 * Suggest a supplier name from a GTIN. Returns undefined if no seed prefix
 * matches — the UI then asks the user to type the supplier on first sight.
 */
export function suggestSupplier(gtin: string | undefined): string | undefined {
  if (!gtin) return undefined;
  let best: SupplierSeed | undefined;
  for (const seed of SUPPLIER_SEEDS) {
    if (gtin.startsWith(seed.prefix)) {
      if (!best || seed.prefix.length > best.prefix.length) best = seed;
    }
  }
  return best?.name;
}

// ---------------------------------------------------------------------------
// Supplier name list (New receival type-ahead)
// ---------------------------------------------------------------------------

/**
 * Seed list for the Supplier type-ahead — plain names, easy to edit. The
 * field never forces a selection: any free-typed supplier is accepted and
 * remembered on-device (rememberSupplier), so the list grows with use.
 */
export const SUPPLIER_NAMES: string[] = [
  // Brokers / importers / traders (source from multiple producers)
  'Farmlands Mathias',
  'Lanexco',
  'Markwell Foods',
  'APJ Meats',
  'JR Wholesale Meats',
  'Ken Wilson Meats',
  'Cabernet Foods',
  // NZ processors / manufacturers
  'Affco',
  'Alliance Group',
  'Andrews Meat Industries',
  'ANZCO Foods',
  'Blue Sky Meats',
  'Crusader Meats',
  'Freshpork',
  'Greenlea Premier Meats',
  'Green Meadows Beef',
  'Harris Farms',
  'Hellers',
  'Mainland Poultry',
  'Ovation New Zealand',
  'Pacific Pork',
  'Progressive Meats',
  'Riverlands',
  'Silver Fern Farms',
  'Taylor Preston',
  'Tegel',
  'Universal Beef Packers',
  'Van Den Brink Poultry',
  'Wilson Hellaby',
  'Beard Brothers',
  // Imported producers (seen via brokers)
  'JBS USA / Swift',
  'Smithfield',
  'Teys Australia',
  'Fribin Foods',
];

/** Suppliers typed on New receival that aren't in the seed list (on-device). */
export function loadCustomSuppliers(): string[] {
  return loadJSON<string[]>(STORAGE_KEYS.customSuppliers, []);
}

/**
 * Remember a free-typed supplier so it appears in the type-ahead next time.
 * No-op for names already known (seed or custom, case-insensitive).
 */
export function rememberSupplier(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  const known = [...SUPPLIER_NAMES, ...loadCustomSuppliers()];
  if (known.some((n) => n.toLowerCase() === key)) return;
  saveJSON(STORAGE_KEYS.customSuppliers, [...loadCustomSuppliers(), trimmed]);
}

/**
 * Type-ahead matches for the Supplier field: case-insensitive, matching
 * anywhere in the name; exact match first, then prefix matches, then
 * contains-matches (alphabetical within each group).
 */
export function searchSuppliers(query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = [...new Set([...SUPPLIER_NAMES, ...loadCustomSuppliers()])];
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 3;
  };
  return all
    .map((name) => ({ name, rank: rank(name) }))
    .filter((e) => e.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((e) => e.name);
}
