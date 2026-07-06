/**
 * Per-supplier product-name memory for the manual "start product" step.
 *
 * When the first carton of a product has a dead barcode, the operator names
 * the product by hand. Names are remembered on-device keyed by supplier so
 * the next manual start for that supplier offers them — the list grows with
 * use, like the supplier type-ahead. Pure localStorage; no backend.
 */

import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

type ProductMap = Record<string, string[]>;

function keyFor(supplier: string): string {
  return supplier.trim().toLowerCase();
}

function loadMap(): ProductMap {
  return loadJSON<ProductMap>(STORAGE_KEYS.supplierProducts, {});
}

/** Product names previously seen for a supplier (most-recent first). */
export function loadSupplierProducts(supplier: string): string[] {
  return loadMap()[keyFor(supplier)] ?? [];
}

/** Remember a product name under its supplier. No-op for blanks / duplicates. */
export function rememberProduct(supplier: string, name: string): void {
  const s = keyFor(supplier);
  const trimmed = name.trim();
  if (!s || !trimmed) return;
  const map = loadMap();
  const existing = map[s] ?? [];
  if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return;
  map[s] = [trimmed, ...existing].slice(0, 50);
  saveJSON(STORAGE_KEYS.supplierProducts, map);
}

/**
 * Type-ahead matches for a supplier's products: case-insensitive, matching
 * anywhere in the name; exact, then prefix, then contains (recency within a
 * group). `extra` folds in the current session's product names so they're
 * offered even before they've been remembered.
 */
export function searchSupplierProducts(
  supplier: string,
  query: string,
  extra: string[] = [],
  limit = 8,
): string[] {
  const pool = [...new Set([...loadSupplierProducts(supplier), ...extra.map((n) => n.trim()).filter(Boolean)])];
  const q = query.trim().toLowerCase();
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (!q) return 3; // no query -> show recent, unranked
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 4; // no match
  };
  return pool
    .map((name, i) => ({ name, rank: rank(name), i }))
    .filter((e) => e.rank < 4)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, limit)
    .map((e) => e.name);
}
