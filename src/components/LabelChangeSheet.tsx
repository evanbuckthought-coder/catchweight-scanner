import type { ParsedCarton } from '../lib/gs1';
import { roundKg } from '../lib/units';

interface LabelChangeSheetProps {
  parsed: ParsedCarton;
  /** The product currently being captured. */
  activeProductName: string;
  activeGtin: string;
  onAddAnyway: () => void;
  onCancel: () => void;
  onNextProduct: () => void;
}

/**
 * Raised when a scanned carton's GTIN/fingerprint differs from the cartons
 * already captured for the current product. Catches both a stray carton mixed
 * into the pallet and the operator forgetting to tap "Next product".
 */
export function LabelChangeSheet({
  parsed,
  activeProductName,
  activeGtin,
  onAddAnyway,
  onCancel,
  onNextProduct,
}: LabelChangeSheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <div className="mb-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/40">
          ⚠ This label differs from the others for this product. Continue, or start
          “Next product”?
        </div>

        <div className="rounded-xl bg-slate-800/70 px-3 py-2 text-sm">
          <div className="flex justify-between gap-3 border-b border-slate-700/60 py-1">
            <span className="text-slate-400">Current product</span>
            <span className="text-right font-medium text-slate-100 break-all">
              {activeProductName}
            </span>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-700/60 py-1">
            <span className="text-slate-400">Current GTIN</span>
            <span className="text-right font-mono text-slate-300 break-all">{activeGtin || '—'}</span>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-700/60 py-1">
            <span className="text-slate-400">Scanned GTIN</span>
            <span className="text-right font-mono text-amber-300 break-all">
              {parsed.gtin || '—'}
            </span>
          </div>
          <div className="flex justify-between gap-3 py-1">
            <span className="text-slate-400">Scanned weight</span>
            <span className="text-right font-medium text-slate-100">
              {roundKg(parsed.weightKg ?? 0).toFixed(2)} kg
            </span>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            data-testid="label-next-product"
            onClick={onNextProduct}
            className="rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400"
          >
            Start “Next product” with this carton
          </button>
          <button
            type="button"
            data-testid="label-add-anyway"
            onClick={onAddAnyway}
            className="rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-200 active:bg-slate-600"
          >
            Add anyway to “{activeProductName}”
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl bg-transparent py-3 text-base font-semibold text-slate-400 active:text-slate-200"
          >
            Cancel scan
          </button>
        </div>
      </div>
    </div>
  );
}
