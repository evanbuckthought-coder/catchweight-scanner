import { roundKg } from '../lib/units';

interface ReadoutProps {
  totalKg: number;
  cartonCount: number;
  mixedUnits: boolean;
  lastWeightKg?: number;
  lastUnit?: 'kg' | 'lb';
  lastNetWeight?: number;
}

/** Big scale-style running total in kg, plus the most recent carton. */
export function Readout({
  totalKg,
  cartonCount,
  mixedUnits,
  lastWeightKg,
  lastUnit,
  lastNetWeight,
}: ReadoutProps) {
  return (
    <div className="rounded-2xl bg-slate-800/80 p-4 text-center shadow-lg ring-1 ring-slate-700">
      <div className="text-xs font-medium uppercase tracking-widest text-slate-400">
        Pallet total
      </div>
      <div className="mt-1 font-mono text-6xl font-bold tabular-nums text-emerald-400">
        {roundKg(totalKg).toFixed(2)}
        <span className="ml-2 text-2xl text-slate-400">kg</span>
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-sm text-slate-300">
        <span>
          <span className="font-semibold text-slate-100">{cartonCount}</span> carton
          {cartonCount === 1 ? '' : 's'}
        </span>
        {lastWeightKg !== undefined && (
          <span className="text-slate-400">
            last: {lastNetWeight}
            {lastUnit}
            {lastUnit === 'lb' ? ` → ${roundKg(lastWeightKg).toFixed(2)}kg` : ''}
          </span>
        )}
      </div>
      {mixedUnits && (
        <div className="mt-3 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/40">
          ⚠ MIXED UNITS (kg + lb) — total normalised to kg, flag for supervisor review
        </div>
      )}
    </div>
  );
}
