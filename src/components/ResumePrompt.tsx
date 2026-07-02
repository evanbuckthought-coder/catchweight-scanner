import { useState } from 'react';
import type { Session } from '../types';
import { poTotals } from '../lib/session';

interface ResumePromptProps {
  session: Session;
  onResume: () => void;
  onDiscard: () => void;
}

/**
 * Shown on reopening when an unfinished session was found on the device — a
 * refresh, accidental close, or app update must never silently lose or silently
 * resume a half-counted PO. The operator chooses.
 */
export function ResumePrompt({ session, onResume, onDiscard }: ResumePromptProps) {
  const totals = poTotals(session);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  return (
    <div className="flex min-h-screen flex-col justify-center gap-5 p-6">
      <div className="text-center">
        <div className="text-4xl">🧾</div>
        <h1 className="mt-2 text-2xl font-bold">Unfinished session found</h1>
        <p className="mt-1 text-sm text-slate-400">
          A receiving session was in progress on this device.
        </p>
      </div>

      <div className="rounded-2xl bg-slate-800/80 p-4 ring-1 ring-slate-700">
        <div className="flex justify-between gap-3 border-b border-slate-700/60 py-1.5 text-sm">
          <span className="text-slate-400">PO</span>
          <span className="font-semibold text-slate-100">{session.poRef}</span>
        </div>
        <div className="flex justify-between gap-3 border-b border-slate-700/60 py-1.5 text-sm">
          <span className="text-slate-400">Supplier</span>
          <span className="text-slate-100">
            {session.supplier}
            {session.brand ? ` · ${session.brand}` : ''}
          </span>
        </div>
        <div className="flex justify-between gap-3 border-b border-slate-700/60 py-1.5 text-sm">
          <span className="text-slate-400">Started</span>
          <span className="text-slate-100">{new Date(session.startedAt).toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-3 py-1.5 text-sm">
          <span className="text-slate-400">Captured</span>
          <span className="font-mono font-semibold text-emerald-400">
            {totals.kg.toFixed(2)} kg · {totals.cartonCount} ctn · {totals.productCount} product
            {totals.productCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <button
        type="button"
        data-testid="resume-session"
        onClick={onResume}
        className="rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400"
      >
        ▶ Resume last session
      </button>

      {!confirmDiscard ? (
        <button
          type="button"
          data-testid="resume-discard"
          onClick={() => setConfirmDiscard(true)}
          className="rounded-xl bg-slate-800 py-3 text-sm font-semibold text-rose-300 ring-1 ring-slate-600"
        >
          Discard it
        </button>
      ) : (
        <div className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
          <p className="text-sm text-rose-200">
            Discard the unfinished session ({totals.cartonCount} carton
            {totals.cartonCount === 1 ? '' : 's'})? This can’t be undone.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-medium text-slate-200"
            >
              Keep
            </button>
            <button
              type="button"
              data-testid="resume-discard-confirm"
              onClick={onDiscard}
              className="flex-1 rounded-lg bg-rose-500 py-2 text-sm font-bold text-slate-900"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
