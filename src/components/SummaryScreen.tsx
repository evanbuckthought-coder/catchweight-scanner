import { useState } from 'react';
import type { Session } from '../types';
import { poTotals, productSubtotal } from '../lib/session';

interface SummaryScreenProps {
  session: Session;
  onAmendProduct: (productId: string) => void;
  onCaptureNewProduct: () => void;
  onBackToScan: () => void;
  onExport: () => void;
  onEndSession: () => void;
}

/** End-of-session review: per-product subtotals, PO total, amend / export / end. */
export function SummaryScreen({
  session,
  onAmendProduct,
  onCaptureNewProduct,
  onBackToScan,
  onExport,
  onEndSession,
}: SummaryScreenProps) {
  const totals = poTotals(session);
  const [confirmEnd, setConfirmEnd] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-3">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBackToScan}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-slate-600"
        >
          ‹ Scan
        </button>
        <div className="min-w-0 flex-1 text-right">
          <div className="truncate text-sm font-semibold text-slate-100">{session.poRef}</div>
          <div className="truncate text-xs text-slate-400">
            {session.supplier}
            {session.brand ? ` · ${session.brand}` : ''} · by {session.scannedBy}
          </div>
        </div>
      </header>

      <h1 className="text-lg font-bold">Session summary</h1>

      {session.products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          No products captured yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {session.products.map((p) => {
            const sub = productSubtotal(p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid={`summary-product-${p.id}`}
                  onClick={() => onAmendProduct(p.id)}
                  className="flex w-full items-center gap-3 rounded-xl bg-slate-800/70 px-3 py-3 text-left ring-1 ring-slate-700 active:bg-slate-700"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-100">
                      {p.product || '(unnamed)'}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {sub.count} carton{sub.count === 1 ? '' : 's'} · GTIN {p.gtin || '—'}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono font-bold tabular-nums text-emerald-400">
                    {sub.kg.toFixed(2)} kg
                  </span>
                  <span className="shrink-0 text-slate-500">›</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-2xl bg-slate-800/80 p-4 text-center ring-1 ring-slate-700">
        <div className="text-xs font-medium uppercase tracking-widest text-slate-400">PO total</div>
        <div className="mt-1 font-mono text-4xl font-bold tabular-nums text-emerald-400">
          {totals.kg.toFixed(2)}
          <span className="ml-2 text-xl text-slate-400">kg</span>
        </div>
        <div className="mt-1 text-sm text-slate-300">
          {totals.cartonCount} carton{totals.cartonCount === 1 ? '' : 's'} · {totals.productCount}{' '}
          product{totals.productCount === 1 ? '' : 's'}
          {totals.manual > 0 ? ` · ${totals.manual} manual` : ''}
        </div>
        {totals.mixedUnits && (
          <div className="mt-3 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/40">
            ⚠ MIXED UNITS (kg + lb) — flag for supervisor review
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onCaptureNewProduct}
        className="rounded-xl bg-slate-800 py-3 text-base font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700"
      >
        + Capture another product
      </button>

      <button
        type="button"
        data-testid="export"
        disabled={totals.cartonCount === 0}
        onClick={onExport}
        className="rounded-xl bg-sky-500 py-3 text-base font-bold text-slate-900 active:bg-sky-400 disabled:opacity-40"
      >
        ⬇ Export to Excel
      </button>

      {!confirmEnd ? (
        <button
          type="button"
          onClick={() => setConfirmEnd(true)}
          className="rounded-xl bg-rose-500/20 py-3 text-base font-semibold text-rose-300 ring-1 ring-rose-500/40"
        >
          End session
        </button>
      ) : (
        <div className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
          <p className="text-sm text-rose-200">End and clear this PO? Export first if you need it.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmEnd(false)}
              className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-medium text-slate-200"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={onEndSession}
              className="flex-1 rounded-lg bg-rose-500 py-2 text-sm font-bold text-slate-900"
            >
              End session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
