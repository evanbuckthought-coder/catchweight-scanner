import { useState } from 'react';
import type { Session } from '../types';
import { palletSubtotal, poTotals, productSubtotal } from '../lib/session';

interface SummaryScreenProps {
  session: Session;
  onAmendProduct: (productId: string) => void;
  onAmendPallet: (productId: string, palletId: string) => void;
  onCaptureNewProduct: () => void;
  onBackToScan: () => void;
  onExport: () => void;
  onEndSession: () => void;
}

/** End-of-session review: products with their pallets, subtotals, and PO total. */
export function SummaryScreen({
  session,
  onAmendProduct,
  onAmendPallet,
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
        <ul className="flex flex-col gap-3">
          {session.products.map((p) => {
            const sub = productSubtotal(p);
            return (
              <li key={p.id} className="rounded-xl bg-slate-800/50 ring-1 ring-slate-700">
                <button
                  type="button"
                  data-testid={`summary-product-${p.id}`}
                  onClick={() => onAmendProduct(p.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-slate-700/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-100">
                      {p.product || '(unnamed)'}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {sub.count} carton{sub.count === 1 ? '' : 's'} · {p.pallets.length} pallet
                      {p.pallets.length === 1 ? '' : 's'} · GTIN {p.gtin || '—'}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono font-bold tabular-nums text-emerald-400">
                    {sub.kg.toFixed(2)} kg
                  </span>
                </button>

                <ul className="flex flex-col gap-1 border-t border-slate-700/60 px-2 py-2">
                  {p.pallets.map((pal, i) => {
                    const ps = palletSubtotal(pal);
                    return (
                      <li key={pal.id}>
                        <button
                          type="button"
                          data-testid={`summary-pallet-${pal.id}`}
                          onClick={() => onAmendPallet(p.id, pal.id)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm active:bg-slate-700/40"
                        >
                          <span className="min-w-0 flex-1 truncate text-slate-300">
                            Pallet {i + 1}
                            {pal.palletId ? ` · ${pal.palletId}` : ''}
                            <span className="text-slate-500">
                              {' '}
                              · {ps.count} carton{ps.count === 1 ? '' : 's'}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono tabular-nums text-slate-200">
                            {ps.kg.toFixed(2)} kg
                          </span>
                          <span className="shrink-0 text-slate-500">›</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
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
          product{totals.productCount === 1 ? '' : 's'} · {totals.palletCount} pallet
          {totals.palletCount === 1 ? '' : 's'}
          {totals.manual > 0 ? ` · ${totals.manual} manual` : ''}
          {totals.ocr > 0 ? ` · ${totals.ocr} OCR` : ''}
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
