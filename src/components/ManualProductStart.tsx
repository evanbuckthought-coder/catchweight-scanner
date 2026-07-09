import { useMemo, useRef, useState } from 'react';
import { searchSupplierProducts } from '../lib/products';

/** What a manual product start establishes (dates are ISO YYYY-MM-DD). */
export interface ManualProductInit {
  productionDate?: string;
  bestBefore?: string;
  /** True only when the operator explicitly chose "No date available". */
  productionDateUnavailable?: boolean;
}

interface ManualProductStartProps {
  supplier: string;
  /** Product names already in this session (offered before they're remembered). */
  sessionProducts: string[];
  onStart: (product: string, init: ManualProductInit) => void;
}

/**
 * The manual equivalent of the first-carton confirm: when a product's first
 * carton has a dead barcode, the human establishes what the product is so the
 * keypad has something to count into. Supplier/brand inherit from the session.
 *
 * Production date is strongly prompted for (the WMS depends on it): starting
 * without one raises a confirm rather than silently allowing or hard-blocking.
 * Best-before is optional (and could later be derived from production date +
 * a shelf-life rule — deliberately kept as its own field).
 */
export function ManualProductStart({ supplier, sessionProducts, onStart }: ManualProductStartProps) {
  const [product, setProduct] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [bestBefore, setBestBefore] = useState('');
  const [focused, setFocused] = useState(false);
  const [confirmNoDate, setConfirmNoDate] = useState(false);
  const prodDateRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const matches = searchSupplierProducts(supplier, product, sessionProducts);
    if (matches.length === 1 && matches[0].toLowerCase() === product.trim().toLowerCase()) return [];
    return matches;
  }, [supplier, product, sessionProducts]);
  const showSuggestions = focused && suggestions.length > 0;

  const canStart = product.trim().length > 0;

  const start = (init: ManualProductInit) => onStart(product.trim(), init);

  const attempt = () => {
    if (!canStart) return;
    if (!productionDate) {
      setConfirmNoDate(true); // mandatory-but-not-hard-blocked: confirm intent
      return;
    }
    start({ productionDate, bestBefore: bestBefore || undefined });
  };

  const focusProductionDate = () => {
    setConfirmNoDate(false);
    const el = prodDateRef.current;
    el?.focus();
    // iOS 16+/Chrome open the native picker on demand; harmless where absent.
    try {
      (el as unknown as { showPicker?: () => void })?.showPicker?.();
    } catch {
      /* not allowed in this context — focus alone is fine */
    }
  };

  const dateField = (
    label: string,
    testid: string,
    value: string,
    setValue: (v: string) => void,
    opts?: { required?: boolean; ref?: React.RefObject<HTMLInputElement | null> },
  ) => (
    <label className="block flex-1 text-sm font-medium text-slate-300">
      {label}{' '}
      {opts?.required ? (
        <span className="text-amber-300">*</span>
      ) : (
        <span className="text-slate-500">(if known)</span>
      )}
      <input
        ref={opts?.ref}
        data-testid={testid}
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
    </label>
  );

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
        {dateField('Production date', 'manual-production-date', productionDate, (v) => setProductionDate(v), {
          required: true,
          ref: prodDateRef,
        })}
        {dateField('Best before', 'manual-best-before', bestBefore, setBestBefore)}
      </div>

      {confirmNoDate ? (
        <div data-testid="manual-nodate-confirm" className="rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-500/40">
          <p className="text-sm font-semibold text-amber-200">Please enter a production date.</p>
          <p className="mt-1 text-xs text-amber-300/80">
            Date management in the warehouse relies on it. Enter it if you can read it off the label.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              data-testid="manual-nodate-enter"
              onClick={focusProductionDate}
              className="h-12 rounded-xl bg-emerald-500 text-base font-bold text-slate-900 active:bg-emerald-400"
            >
              Enter date
            </button>
            <button
              type="button"
              data-testid="manual-nodate-proceed"
              onClick={() => {
                setConfirmNoDate(false);
                start({ bestBefore: bestBefore || undefined, productionDateUnavailable: true });
              }}
              className="h-12 rounded-xl bg-slate-800 text-base font-semibold text-slate-300 ring-1 ring-slate-600 active:bg-slate-700"
            >
              No date available
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="manual-product-start"
          disabled={!canStart}
          onClick={attempt}
          className="h-14 rounded-xl bg-emerald-500 text-lg font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
        >
          Start product → keypad
        </button>
      )}
    </div>
  );
}
