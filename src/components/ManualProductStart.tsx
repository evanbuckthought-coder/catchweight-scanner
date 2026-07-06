import { useMemo, useState } from 'react';
import { searchSupplierProducts } from '../lib/products';

interface ManualProductStartProps {
  supplier: string;
  /** Product names already in this session (offered before they're remembered). */
  sessionProducts: string[];
  onStart: (product: string, batch: string | undefined, cartonId: string | undefined) => void;
}

/**
 * The manual equivalent of the first-carton confirm: when a product's first
 * carton has a dead barcode, the human establishes what the product is so the
 * keypad has something to count into. Supplier/brand inherit from the session;
 * batch and a by-eye carton ID are optional traceability the operator can read
 * off the label.
 */
export function ManualProductStart({ supplier, sessionProducts, onStart }: ManualProductStartProps) {
  const [product, setProduct] = useState('');
  const [batch, setBatch] = useState('');
  const [cartonId, setCartonId] = useState('');
  const [focused, setFocused] = useState(false);

  const suggestions = useMemo(() => {
    const matches = searchSupplierProducts(supplier, product, sessionProducts);
    if (matches.length === 1 && matches[0].toLowerCase() === product.trim().toLowerCase()) return [];
    return matches;
  }, [supplier, product, sessionProducts]);
  const showSuggestions = focused && suggestions.length > 0;

  const canStart = product.trim().length > 0;

  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl bg-slate-900 p-4 ring-1 ring-slate-700">
      <div className="rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/40">
        Start a product by hand — for a first carton whose barcode won’t scan. Supplier{' '}
        <span className="font-semibold">{supplier}</span> is inherited; the product is flagged as
        started manually (no barcode).
      </div>

      <label className="relative block text-sm font-medium text-slate-300">
        Product name *
        <input
          data-testid="manual-product-name"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="e.g. Boneless beef striploins"
          autoComplete="off"
          autoFocus
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        {showSuggestions && (
          <ul
            data-testid="manual-product-suggestions"
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-xl bg-slate-800 py-1 shadow-lg shadow-black/50 ring-1 ring-slate-600"
          >
            {suggestions.map((name, i) => (
              <li key={name}>
                <button
                  type="button"
                  data-testid={`manual-product-suggestion-${i}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setProduct(name);
                    setFocused(false);
                  }}
                  className="w-full px-3 py-2.5 text-left text-base font-normal text-slate-100 active:bg-slate-700"
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </label>

      <div className="flex gap-2">
        <label className="block flex-1 text-sm font-medium text-slate-300">
          Batch / Lot <span className="text-slate-500">(optional)</span>
          <input
            data-testid="manual-product-batch"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="read by eye"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>
        <label className="block flex-1 text-sm font-medium text-slate-300">
          Carton ID <span className="text-slate-500">(optional)</span>
          <input
            data-testid="manual-product-cartonid"
            value={cartonId}
            onChange={(e) => setCartonId(e.target.value)}
            placeholder="if visible"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>
      </div>

      <button
        type="button"
        data-testid="manual-product-start"
        disabled={!canStart}
        onClick={() => onStart(product.trim(), batch.trim() || undefined, cartonId.trim() || undefined)}
        className="h-14 rounded-xl bg-emerald-500 text-lg font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
      >
        Start product → keypad
      </button>
    </div>
  );
}
