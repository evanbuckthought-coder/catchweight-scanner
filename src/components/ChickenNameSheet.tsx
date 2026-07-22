import { useState } from 'react';
import type { ParsedCarton } from '../lib/gs1';
import { roundKg } from '../lib/units';

interface ChickenNameSheetProps {
  gtin: string;
  /** The scan that triggered this — its weight/dates give context. */
  parsed: ParsedCarton;
  /** Save the product name and count the carton. */
  onSave: (product: string) => void;
  /** Hand off to the AI teach flow to read the description off the label. */
  onTeachWithAi: () => void;
  onCancel: () => void;
}

/**
 * First scan of a RANDOM-WEIGHT product the app hasn't seen: the barcode
 * carries the carton's weight, but nothing may count UNNAMED — "(unnamed)"
 * on a spreadsheet is a defect. The name is asked ONCE here, saved on the
 * GTIN profile, and every later scan counts instantly under that name.
 */
export function ChickenNameSheet({ gtin, parsed, onSave, onTeachWithAi, onCancel }: ChickenNameSheetProps) {
  const [product, setProduct] = useState('');

  const dates = [
    parsed.productionDate && `Prod ${parsed.productionDate}`,
    parsed.bestBefore && `BB ${parsed.bestBefore}`,
    parsed.useBy && `Use by ${parsed.useBy}`,
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div
        data-testid="chicken-name-sheet"
        className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <h2 className="text-lg font-bold text-slate-100">New product — name it</h2>
        <p className="mt-1 text-sm text-slate-400">
          First time seeing this product. Its weight comes from the barcode
          {parsed.weightKg != null && (
            <span className="font-semibold text-slate-200"> ({roundKg(parsed.weightKg).toFixed(2)} kg this carton)</span>
          )}
          , but it needs a name so the count and spreadsheet read properly. Asked{' '}
          <span className="font-semibold text-slate-200">once</span> — every later scan counts
          instantly.
        </p>

        <div className="mt-3 rounded-xl bg-slate-800/70 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-700">
          <div>GTIN {gtin}</div>
          {dates.length > 0 && <div className="mt-0.5">{dates.join(' · ')}</div>}
        </div>

        <button
          type="button"
          data-testid="chicken-name-ai"
          onClick={onTeachWithAi}
          className="mt-4 h-12 w-full rounded-xl bg-indigo-500 text-base font-bold text-white active:bg-indigo-400"
        >
          📷 Read the label with AI
          <span className="block text-[11px] font-medium text-indigo-100/80">
            fills in the description — needs internet
          </span>
        </button>

        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-700" /> or type it{' '}
          <span className="h-px flex-1 bg-slate-700" />
        </div>

        <label className="mt-2 block text-sm font-medium text-slate-300">
          Product name *
          <input
            data-testid="chicken-name-product"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="e.g. CHICKEN BRST SKINLESS"
            autoComplete="off"
            autoFocus
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>

        <button
          type="button"
          data-testid="chicken-name-save"
          disabled={!product.trim()}
          onClick={() => onSave(product.trim())}
          className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-lg font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
        >
          Save name &amp; count carton
        </button>

        <button
          type="button"
          data-testid="chicken-name-cancel"
          onClick={onCancel}
          className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-sm font-medium text-slate-400 ring-1 ring-slate-700"
        >
          Cancel — don’t count this carton
        </button>
      </div>
    </div>
  );
}
