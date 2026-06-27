import { useState } from 'react';
import type { GtinProfile } from '../types';
import type { ManualEntryInput } from '../lib/carton';
import { suggestSupplier } from '../lib/suppliers';
import { toKg, roundKg, type WeightUnit } from '../lib/units';

interface ManualEntrySheetProps {
  profiles: Record<string, GtinProfile>;
  onSubmit: (input: ManualEntryInput) => void;
  onCancel: () => void;
}

/**
 * Fallback entry for when a barcode is damaged/frosted/won't scan. The operator
 * keys in net weight + unit and a product. If they can read the printed GTIN
 * they can type it to pull product/supplier from a saved profile (same data the
 * scan flow uses); otherwise it's free text. Entries are flagged manual.
 */
export function ManualEntrySheet({ profiles, onSubmit, onCancel }: ManualEntrySheetProps) {
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [gtin, setGtin] = useState('');
  const [product, setProduct] = useState('');
  const [supplier, setSupplier] = useState('');
  const [batch, setBatch] = useState('');

  const weightNum = Number(weight);
  const weightValid = weight.trim() !== '' && Number.isFinite(weightNum) && weightNum > 0;
  const canSubmit = weightValid && product.trim().length > 0;

  const trimmedGtin = gtin.trim();
  const knownProfile = trimmedGtin ? profiles[trimmedGtin] : undefined;
  const suggested = trimmedGtin ? suggestSupplier(trimmedGtin) : undefined;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      netWeight: weightNum,
      unit,
      product: product.trim(),
      supplier: supplier.trim(),
      gtin: trimmedGtin || undefined,
      batch: batch.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <div className="mb-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/40">
          Manual entry — for a damaged/unreadable barcode. This carton will be flagged
          “Manual” in the list and the export.
        </div>

        {/* Weight + unit */}
        <label className="block text-sm font-medium text-slate-300">
          Net weight *
          <div className="mt-1 flex gap-2">
            <input
              inputMode="decimal"
              autoFocus
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="e.g. 13.62"
              className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-600">
              {(['kg', 'lb'] as WeightUnit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={`px-4 py-3 text-base font-semibold ${
                    unit === u ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          {weightValid && unit === 'lb' && (
            <span className="mt-1 block text-xs text-slate-400">
              = {roundKg(toKg(weightNum, 'lb')).toFixed(2)} kg
            </span>
          )}
        </label>

        {/* Optional GTIN */}
        <label className="mt-4 block text-sm font-medium text-slate-300">
          GTIN (optional — if the printed code is legible)
          <input
            inputMode="numeric"
            value={gtin}
            onChange={(e) => setGtin(e.target.value)}
            placeholder="14-digit GTIN"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 font-mono text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>
        {knownProfile && (
          <button
            type="button"
            onClick={() => {
              setProduct(knownProfile.productName);
              setSupplier(knownProfile.supplierName);
            }}
            className="mt-2 text-xs text-emerald-300 underline"
          >
            Use saved profile: {knownProfile.productName} · {knownProfile.supplierName}
          </button>
        )}

        {/* Product + supplier */}
        <label className="mt-4 block text-sm font-medium text-slate-300">
          Product *
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="e.g. Beef striploin"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-300">
          Supplier
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Supplier name"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>
        {suggested && suggested !== supplier && (
          <button
            type="button"
            onClick={() => setSupplier(suggested)}
            className="mt-2 text-xs text-sky-300 underline"
          >
            Use suggested: {suggested}
          </button>
        )}

        {/* Optional batch/lot */}
        <label className="mt-3 block text-sm font-medium text-slate-300">
          Batch / Lot (optional)
          <input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="Batch or lot number"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-200 active:bg-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="manual-add"
            disabled={!canSubmit}
            onClick={submit}
            className="flex-1 rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
          >
            Add carton
          </button>
        </div>
      </div>
    </div>
  );
}
