import type { ParsedCarton } from '../lib/gs1';
import { roundKg } from '../lib/units';

interface WeightConfirmSheetProps {
  parsed: ParsedCarton;
  warnings: string[];
  productName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Weight sanity check for a scanned carton that isn't the first of its product
 * (those go through the product confirm instead). Forces a human glance on a
 * likely misread before it enters the tally; the operator can confirm against
 * the label or cancel and re-scan / key it manually.
 */
export function WeightConfirmSheet({
  parsed,
  warnings,
  productName,
  onConfirm,
  onCancel,
}: WeightConfirmSheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div className="rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <div className="mb-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/40">
          {warnings.map((w) => (
            <div key={w} className="py-0.5">
              ⚠ {w}
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-slate-800/70 px-3 py-3 text-center">
          <div className="text-xs uppercase tracking-wide text-slate-400">{productName}</div>
          <div className="mt-1 font-mono text-4xl font-bold text-amber-300">
            {roundKg(parsed.weightKg ?? 0).toFixed(2)} <span className="text-xl text-slate-400">kg</span>
          </div>
          {parsed.weightUnit === 'lb' && (
            <div className="text-xs text-slate-400">
              from {parsed.netWeight} lb
            </div>
          )}
          {parsed.gtin && <div className="mt-1 font-mono text-xs text-slate-500">GTIN {parsed.gtin}</div>}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-200 active:bg-slate-600"
          >
            Cancel / re-scan
          </button>
          <button
            type="button"
            data-testid="weight-confirm"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400"
          >
            Confirm &amp; count
          </button>
        </div>
      </div>
    </div>
  );
}
