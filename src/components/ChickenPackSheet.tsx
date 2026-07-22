import { useState } from 'react';
import type { ParsedCarton } from '../lib/gs1';

interface ChickenPackSheetProps {
  gtin: string;
  /** The scan that triggered this — its dates give useful context. */
  parsed: ParsedCarton;
  /** Save the learned pack weight (kg), or null for "count only, no kg". */
  onSave: (product: string, packKg: number | null) => void;
  /** Hand off to the AI teach flow to read the description + pack size. */
  onTeachWithAi: () => void;
  onCancel: () => void;
}

/**
 * First scan of a SET-WEIGHT chicken product: its barcode carries no weight
 * AI, so this is a count-by-carton line. The set weight is entered ONCE here
 * (usually the printed pack size, e.g. 10 kg), saved on the GTIN profile, and
 * every later scan just COUNTS THE CARTON — kg is derived, never re-asked.
 */
export function ChickenPackSheet({ gtin, parsed, onSave, onTeachWithAi, onCancel }: ChickenPackSheetProps) {
  const [product, setProduct] = useState('');
  const [weight, setWeight] = useState('');

  const kg = Number(weight);
  const weightValid = weight.trim() !== '' && Number.isFinite(kg) && kg > 0;

  const dates = [
    parsed.productionDate && `Prod ${parsed.productionDate}`,
    parsed.bestBefore && `BB ${parsed.bestBefore}`,
    parsed.useBy && `Use by ${parsed.useBy}`,
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div
        data-testid="chicken-pack-sheet"
        className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <h2 className="text-lg font-bold text-slate-100">New set-weight product</h2>
        <p className="mt-1 text-sm text-slate-400">
          This barcode carries no weight — a set-weight line, counted{' '}
          <span className="font-semibold text-slate-200">by carton</span>. Enter the set weight{' '}
          <span className="font-semibold text-slate-200">once</span>; every later scan just counts
          the carton and kg is worked out from the count.
        </p>

        <div className="mt-3 rounded-xl bg-slate-800/70 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-700">
          <div>GTIN {gtin}</div>
          {dates.length > 0 && <div className="mt-0.5">{dates.join(' · ')}</div>}
        </div>

        <button
          type="button"
          data-testid="chicken-pack-ai"
          onClick={onTeachWithAi}
          className="mt-4 h-12 w-full rounded-xl bg-indigo-500 text-base font-bold text-white active:bg-indigo-400"
        >
          📷 Read the label with AI
          <span className="block text-[11px] font-medium text-indigo-100/80">
            fills in the description &amp; pack size — needs internet
          </span>
        </button>

        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-700" /> or enter it yourself{' '}
          <span className="h-px flex-1 bg-slate-700" />
        </div>

        <label className="mt-2 block text-sm font-medium text-slate-300">
          Product name <span className="text-slate-500">(optional)</span>
          <input
            data-testid="chicken-pack-product"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="e.g. FS FDSERV WINGS 10KG"
            autoComplete="off"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-300">
          Set weight (kg per carton) *
          <input
            data-testid="chicken-pack-weight"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            inputMode="decimal"
            autoFocus
            placeholder="e.g. 10"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-2xl font-bold tabular-nums text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>

        <button
          type="button"
          data-testid="chicken-pack-save"
          disabled={!weightValid}
          onClick={() => onSave(product.trim(), kg)}
          className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-lg font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
        >
          Save set weight — count this carton
        </button>

        <button
          type="button"
          data-testid="chicken-pack-countonly"
          onClick={() => onSave(product.trim(), null)}
          className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-base font-semibold text-slate-300 ring-1 ring-slate-600 active:bg-slate-700"
        >
          Count cartons only — no weight
        </button>

        <button
          type="button"
          data-testid="chicken-pack-cancel"
          onClick={onCancel}
          className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-sm font-medium text-slate-400 ring-1 ring-slate-700"
        >
          Cancel — don’t count this carton
        </button>
      </div>
    </div>
  );
}
