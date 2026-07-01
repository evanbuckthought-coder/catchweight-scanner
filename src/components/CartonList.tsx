import type { CartonRecord } from '../types';
import { roundKg } from '../lib/units';

interface CartonListProps {
  cartons: CartonRecord[];
  onRemove: (id: string) => void;
}

/** Scrollable list of captured cartons, newest first, each removable. */
export function CartonList({ cartons, onRemove }: CartonListProps) {
  if (cartons.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
        No cartons captured yet. Scan a label, enter one manually, or use a simulated scan.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {[...cartons].reverse().map((c) => (
        <li
          key={c.id}
          className="flex items-center gap-3 rounded-xl bg-slate-800/70 px-3 py-2 ring-1 ring-slate-700"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-semibold text-slate-100">
                  {c.product || '(unnamed)'}
                </span>
                {c.entry === 'manual' && (
                  <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/40">
                    Manual
                  </span>
                )}
                {c.entry === 'ocr' && (
                  <span className="shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-300 ring-1 ring-sky-500/40">
                    OCR
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono font-bold tabular-nums text-emerald-400">
                {roundKg(c.weightKg).toFixed(2)} kg
              </span>
            </div>
            <div className="truncate text-xs text-slate-400">
              {c.supplier || '(unknown supplier)'} ·{' '}
              {c.unit === 'lb' ? `${c.netWeight} lb` : `${c.netWeight} kg`}
            </div>
            <div className="truncate text-xs text-slate-500">
              {c.traceAI === '10' ? 'Batch' : c.traceAI === '21' ? 'Serial' : 'Trace'}:{' '}
              {c.traceId ?? '—'} · GTIN {c.gtin}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(c.id)}
            aria-label="Remove carton"
            className="shrink-0 rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-rose-300 active:bg-rose-900/50"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
