import { useState } from 'react';
import { entryKg, type ChickenEntry, type ChickenPackProfile } from '../lib/chicken';
import { roundKg } from '../lib/units';

interface ChickenPalletSheetProps {
  /** The one carton that WAS scanned — the pallet copies inherit from it. */
  entry: ChickenEntry;
  packs: Record<string, ChickenPackProfile>;
  /** Confirm with the pallet's TOTAL carton count (incl. the scanned one). */
  onConfirm: (totalCartons: number) => void;
  onCancel: () => void;
}

/** Fat-finger guard — no chicken pallet carries more cartons than this. */
const MAX_PALLET_CARTONS = 500;

/**
 * Whole pallet of one product: the user scanned a single carton and types how
 * many cartons the pallet holds — the rest are added without scanning. For a
 * random-weight product the un-scanned cartons record the scanned carton's
 * weight as an ESTIMATE (marked in the export); set-weight cartons count and
 * derive exactly as if each had been scanned.
 */
export function ChickenPalletSheet({ entry, packs, onConfirm, onCancel }: ChickenPalletSheetProps) {
  const [count, setCount] = useState('');

  const n = Number(count);
  const valid = /^\d+$/.test(count.trim()) && n >= 2 && n <= MAX_PALLET_CARTONS;
  const perKg = roundKg(entryKg(entry, packs));
  const isEstimate = entry.weightSource === 'barcode';
  const name = entry.product || `GTIN ${entry.gtin}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div
        data-testid="chicken-pallet-sheet"
        className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <h2 className="text-lg font-bold text-slate-100">Whole pallet</h2>
        <p className="mt-1 text-sm text-slate-400">
          <span className="font-semibold text-slate-200">{name}</span> — one carton scanned. Enter
          the pallet’s carton count and the rest are added without scanning.
        </p>

        <label className="mt-4 block text-sm font-medium text-slate-300">
          Cartons on the pallet (including the one scanned) *
          <input
            data-testid="chicken-pallet-count"
            value={count}
            onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            autoFocus
            placeholder="e.g. 42"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-3xl font-bold tabular-nums text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>

        {valid && (
          <p
            data-testid="chicken-pallet-preview"
            className="mt-3 rounded-xl bg-slate-800/70 px-3 py-2 text-sm text-slate-300 ring-1 ring-slate-700"
          >
            {perKg > 0 ? (
              <>
                {n} ctn × {perKg} kg ≈{' '}
                <span className="font-mono font-bold text-emerald-400">{roundKg(n * perKg).toFixed(2)} kg</span>
                {isEstimate && (
                  <span className="block text-xs text-amber-300">
                    Estimated — un-scanned cartons copy the scanned carton’s weight, marked
                    “Estimated” on the spreadsheet.
                  </span>
                )}
              </>
            ) : (
              <>{n} cartons — count only, no kg.</>
            )}
          </p>
        )}
        {count !== '' && !valid && (
          <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/40">
            Enter a whole number from 2 to {MAX_PALLET_CARTONS}.
          </p>
        )}

        <button
          type="button"
          data-testid="chicken-pallet-confirm"
          disabled={!valid}
          onClick={() => onConfirm(n)}
          className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-lg font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
        >
          {valid ? `Add ${n - 1} more carton${n - 1 === 1 ? '' : 's'}` : 'Add cartons'}
        </button>

        <button
          type="button"
          data-testid="chicken-pallet-cancel"
          onClick={onCancel}
          className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-sm font-medium text-slate-400 ring-1 ring-slate-700"
        >
          Cancel — just the scanned carton
        </button>
      </div>
    </div>
  );
}
