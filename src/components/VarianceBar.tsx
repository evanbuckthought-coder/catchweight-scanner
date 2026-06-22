import type { VarianceResult } from '../types';
import { roundKg } from '../lib/units';

interface VarianceBarProps {
  variance: VarianceResult;
}

/** Received vs expected, with the match / HOLD decision. */
export function VarianceBar({ variance: v }: VarianceBarProps) {
  const noExpectation = v.expectedKg === undefined && v.expectedCartons === undefined;

  if (noExpectation) {
    return (
      <div className="rounded-xl bg-slate-800/60 px-3 py-2 text-center text-xs text-slate-400 ring-1 ring-slate-700">
        No expected totals set — variance check off (informational count only)
      </div>
    );
  }

  const tone = v.hold
    ? 'bg-rose-500/20 text-rose-300 ring-rose-500/50'
    : 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/50';
  const label = v.hold ? `HOLD — ${v.status.toUpperCase()}` : 'MATCH';

  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${tone}`}>
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold tracking-wide">{label}</span>
        <span className="text-xs opacity-80">
          tol ±{roundKg(v.toleranceKg)} kg
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
        {v.expectedKg !== undefined && (
          <>
            <span className="opacity-80">
              kg: {roundKg(v.receivedKg).toFixed(2)} / {roundKg(v.expectedKg).toFixed(2)}
            </span>
            <span className="text-right font-semibold">
              {v.varianceKg !== undefined && (v.varianceKg >= 0 ? '+' : '')}
              {v.varianceKg?.toFixed(2)} kg
            </span>
          </>
        )}
        {v.expectedCartons !== undefined && (
          <>
            <span className="opacity-80">
              ctns: {v.receivedCartons} / {v.expectedCartons}
            </span>
            <span className="text-right font-semibold">
              {v.varianceCartons !== undefined && (v.varianceCartons >= 0 ? '+' : '')}
              {v.varianceCartons}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
