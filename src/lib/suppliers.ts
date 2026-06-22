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
