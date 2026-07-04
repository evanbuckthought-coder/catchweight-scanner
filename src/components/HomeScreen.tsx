import type { Session } from '../types';
import { poTotals } from '../lib/session';

interface HomeScreenProps {
  /** In-progress session, if one exists on this device. */
  activeSession: Session | null;
  onNewReceival: () => void;
  onResume: () => void;
  onHistory: () => void;
  onLabels: () => void;
  onSettings: () => void;
}

/**
 * App entry point (behind the passcode gate). Optimised for the frequent
 * action: starting a receival is the one-tap hero. Everything done BETWEEN
 * receivals (history, label knowledge, settings) sits below it and never
 * enters the capture path.
 */
export function HomeScreen({
  activeSession,
  onNewReceival,
  onResume,
  onHistory,
  onLabels,
  onSettings,
}: HomeScreenProps) {
  const totals = activeSession ? poTotals(activeSession) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-5">
      <header className="mt-4 text-center">
        <div className="text-4xl">📦</div>
        <h1 className="mt-1 text-2xl font-bold">Catchweight Scanner</h1>
      </header>

      {/* Hero: the frequent action, one tap, unmissable. */}
      <button
        type="button"
        data-testid="home-new-receival"
        onClick={onNewReceival}
        className="mt-2 rounded-2xl bg-emerald-500 py-7 text-2xl font-bold text-slate-900 shadow-lg active:bg-emerald-400"
      >
        ▶ New receival
      </button>

      {/* Surfaced ONLY when an unfinished session exists — never stranded. */}
      {activeSession && totals && (
        <button
          type="button"
          data-testid="home-resume"
          onClick={onResume}
          className="rounded-2xl bg-sky-500/15 px-4 py-4 text-left ring-2 ring-sky-500/60 active:bg-sky-500/25"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-bold text-sky-200">⏸ Resume last session</div>
              <div className="mt-0.5 truncate text-sm text-slate-300">
                {activeSession.poRef} · {activeSession.supplier}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-lg font-bold tabular-nums text-emerald-400">
                {totals.kg.toFixed(2)} kg
              </div>
              <div className="text-xs text-slate-400">
                {totals.cartonCount} ctn{totals.cartonCount === 1 ? '' : 's'} · {totals.productCount}{' '}
                product{totals.productCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        </button>
      )}

      <div className="mt-2 flex flex-col gap-3">
        <button
          type="button"
          data-testid="home-history"
          onClick={onHistory}
          className="rounded-xl bg-slate-800 px-4 py-4 text-left text-base font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700"
        >
          🗂 History
          <span className="block text-xs font-normal text-slate-500">Past receivals · re-export Excel</span>
        </button>

        <button
          type="button"
          data-testid="home-labels"
          onClick={onLabels}
          className="rounded-xl bg-slate-800 px-4 py-4 text-left text-base font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700"
        >
          🏷 Label Intelligence
          <span className="block text-xs font-normal text-slate-500">
            Teach labels · manage barcode &amp; OCR profiles
          </span>
        </button>

        <button
          type="button"
          data-testid="home-settings"
          onClick={onSettings}
          className="rounded-xl bg-slate-800 px-4 py-4 text-left text-base font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700"
        >
          ⚙ Settings
          <span className="block text-xs font-normal text-slate-500">Operator · passcode · app updates</span>
        </button>
      </div>

      <p className="mt-auto pb-2 text-center text-[11px] text-slate-600">Build {__BUILD_ID__}</p>
    </div>
  );
}
