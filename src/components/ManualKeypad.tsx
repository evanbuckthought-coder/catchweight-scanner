import { useState } from 'react';
import { applyKeypadKey, keypadValue, type KeypadKey } from '../lib/keypad';
import { weightWarnings } from '../lib/guardrails';
import { roundKg, toKg, type WeightUnit } from '../lib/units';

interface ManualKeypadProps {
  /** Active product the keypad counts into (guaranteed by the caller). */
  productName: string;
  /** Batch inherited onto each manual carton (shown for transparency). */
  lastBatch?: string;
  /** Persisted unit — kg by default, set once for lb suppliers. */
  unit: WeightUnit;
  onUnitChange: (unit: WeightUnit) => void;
  /** Save the carton. Caller commits instantly — the pad has already gated. */
  onCommit: (netWeight: number, unit: WeightUnit) => void;
}

const KEY_ROWS: KeypadKey[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['.', '0', 'back'],
];

/**
 * Large glove-friendly keypad — manual entry as a PRIMARY capture mode. The
 * rhythm is type → ENTER: a valid in-range weight saves instantly and clears
 * the pad for the next carton. The 1-40 kg range guardrail interrupts inline
 * (typo catch); product/supplier/GTIN/batch are inherited from the active
 * product and the carton is flagged "manual" exactly as before.
 */
export function ManualKeypad({ productName, lastBatch, unit, onUnitChange, onCommit }: ManualKeypadProps) {
  const [value, setValue] = useState('');
  const [rangeWarnings, setRangeWarnings] = useState<string[] | null>(null);

  const num = keypadValue(value);
  const kg = num !== null ? toKg(num, unit) : null;

  const press = (key: KeypadKey) => {
    setRangeWarnings(null);
    setValue((v) => applyKeypadKey(v, key));
  };

  const commit = (netWeight: number) => {
    onCommit(netWeight, unit);
    setValue('');
    setRangeWarnings(null);
  };

  const enter = () => {
    if (num === null || kg === null) return;
    const warnings = weightWarnings({ weightKg: kg });
    if (warnings.length) {
      setRangeWarnings(warnings); // out-of-range -> inline confirm, not silent
      return;
    }
    commit(num);
  };

  return (
    <div className="flex w-full flex-col gap-2 rounded-2xl bg-slate-900 p-3 ring-1 ring-slate-700">
      {/* Context + unit toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-200">{productName}</div>
          <div className="truncate text-xs text-slate-500">
            Batch {lastBatch || '—'} (inherited) · flagged “manual”
          </div>
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-600">
          {(['kg', 'lb'] as WeightUnit[]).map((u) => (
            <button
              key={u}
              type="button"
              data-testid={`keypad-unit-${u}`}
              onClick={() => onUnitChange(u)}
              className={`px-3 py-1.5 text-sm font-semibold ${
                unit === u ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Display */}
      <div className="rounded-xl bg-slate-950 px-4 py-3 ring-1 ring-slate-700">
        <div
          data-testid="keypad-display"
          className="text-right font-mono text-4xl font-bold tabular-nums text-slate-100"
        >
          {value || <span className="text-slate-600">0</span>}
          <span className="ml-2 text-xl font-semibold text-slate-400">{unit}</span>
        </div>
        <div className="h-4 text-right text-xs text-slate-500">
          {unit === 'lb' && kg !== null ? `= ${roundKg(kg).toFixed(2)} kg` : ''}
        </div>
      </div>

      {/* Out-of-range confirm (typo catch) — inline so the rhythm stays fast */}
      {rangeWarnings && (
        <div className="rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-500/40">
          {rangeWarnings.map((w) => (
            <p key={w} className="text-sm text-amber-200">
              ⚠ {w}
            </p>
          ))}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="keypad-range-clear"
              onClick={() => {
                setValue('');
                setRangeWarnings(null);
              }}
              className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-semibold text-slate-200"
            >
              Clear — re-enter
            </button>
            <button
              type="button"
              data-testid="keypad-range-confirm"
              onClick={() => num !== null && commit(num)}
              className="flex-1 rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-slate-900"
            >
              Count anyway
            </button>
          </div>
        </div>
      )}

      {/* Keys */}
      <div className="grid grid-cols-3 gap-2">
        {KEY_ROWS.flat().map((key) => (
          <button
            key={key}
            type="button"
            data-testid={key === '.' ? 'key-dot' : key === 'back' ? 'key-back' : `key-${key}`}
            onClick={() => press(key)}
            className={`h-16 rounded-xl text-2xl font-bold ring-1 ring-slate-600 active:bg-slate-600 ${
              key === 'back' ? 'bg-slate-800 text-rose-300' : 'bg-slate-800 text-slate-100'
            }`}
          >
            {key === 'back' ? '⌫' : key}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="key-enter"
        disabled={num === null || !!rangeWarnings}
        onClick={enter}
        className="h-16 rounded-xl bg-emerald-500 text-xl font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
      >
        ⏎ ENTER — count carton
      </button>
    </div>
  );
}
