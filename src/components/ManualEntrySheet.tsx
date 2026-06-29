import { useState } from 'react';
import type { ManualEntryInput } from '../lib/carton';
import { toKg, roundKg, type WeightUnit } from '../lib/units';
import { MAX_CARTON_KG, MIN_CARTON_KG } from '../lib/guardrails';

interface ManualEntrySheetProps {
  /** Product being captured (for context — product/supplier/GTIN are inherited). */
  productName: string;
  /** Batch of the current product, pre-filled and editable. */
  currentBatch?: string;
  onSubmit: (input: ManualEntryInput) => void;
  onCancel: () => void;
}

/**
 * Damaged-barcode fallback. Product, supplier and GTIN are inherited silently
 * from the product being captured — the operator only keys weight + unit, and a
 * batch that's pre-filled from the product but stays editable (so a genuinely
 * different batch doesn't break the traceability link). Choosing lb prompts a
 * confirmation, since kg is the norm.
 */
type Step = 'form' | 'confirm-lb' | 'confirm-range';

export function ManualEntrySheet({ productName, currentBatch, onSubmit, onCancel }: ManualEntrySheetProps) {
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [batch, setBatch] = useState(currentBatch ?? '');
  const [step, setStep] = useState<Step>('form');

  const weightNum = Number(weight);
  const weightValid = weight.trim() !== '' && Number.isFinite(weightNum) && weightNum > 0;
  const kg = weightValid ? toKg(weightNum, unit) : 0;
  const outOfRange = weightValid && (kg < MIN_CARTON_KG || kg > MAX_CARTON_KG);

  const doSubmit = () => {
    onSubmit({ netWeight: weightNum, unit, batch: batch.trim() || undefined });
  };

  // form -> (lb confirm if lb) -> (range confirm if out of 1-40 kg) -> submit.
  const checkRangeThenSubmit = () => {
    if (outOfRange) {
      setStep('confirm-range');
      return;
    }
    doSubmit();
  };

  const handleAdd = () => {
    if (!weightValid) return;
    if (unit === 'lb') {
      setStep('confirm-lb');
      return;
    }
    checkRangeThenSubmit();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <div className="mb-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/40">
          Manual entry for <span className="font-semibold">{productName}</span> — for a
          damaged/unreadable barcode. Product, supplier and GTIN are inherited; this
          carton is flagged “Manual”.
        </div>

        {/* Weight + unit */}
        <label className="block text-sm font-medium text-slate-300">
          Net weight *
          <div className="mt-1 flex gap-2">
            <input
              inputMode="decimal"
              autoFocus
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                setStep('form');
              }}
              placeholder="e.g. 13.62"
              className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-600">
              {(['kg', 'lb'] as WeightUnit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => {
                    setUnit(u);
                    setStep('form');
                  }}
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

        {/* Batch (pre-filled, editable) */}
        <label className="mt-4 block text-sm font-medium text-slate-300">
          Batch / Lot <span className="text-slate-500">(pre-filled — change if different)</span>
          <input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="Batch or lot number"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </label>

        {step === 'confirm-lb' ? (
          <div className="mt-5 rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
            <p className="text-sm text-rose-200">
              Are you sure you want to record this in <span className="font-bold">lb</span>? It’ll
              be converted to {roundKg(kg).toFixed(2)} kg for the total.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setStep('form')}
                className="flex-1 rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-200"
              >
                No, change unit
              </button>
              <button
                type="button"
                data-testid="manual-confirm-lb"
                onClick={checkRangeThenSubmit}
                className="flex-1 rounded-xl bg-rose-500 py-3 text-base font-bold text-slate-900"
              >
                Yes, record in lb
              </button>
            </div>
          </div>
        ) : step === 'confirm-range' ? (
          <div className="mt-5 rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-500/40">
            <p className="text-sm text-amber-200">
              ⚠ Weight {roundKg(kg).toFixed(2)} kg is outside the normal carton range (
              {MIN_CARTON_KG}–{MAX_CARTON_KG} kg). Confirm against the label, or re-enter.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setStep('form')}
                className="flex-1 rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-200"
              >
                Re-enter
              </button>
              <button
                type="button"
                data-testid="manual-confirm-range"
                onClick={doSubmit}
                className="flex-1 rounded-xl bg-amber-500 py-3 text-base font-bold text-slate-900"
              >
                Confirm weight
              </button>
            </div>
          </div>
        ) : (
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
              disabled={!weightValid}
              onClick={handleAdd}
              className="flex-1 rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
            >
              Add carton
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
