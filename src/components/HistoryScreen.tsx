import { useEffect, useState } from 'react';
import type { Session } from '../types';
import { listReceivals, openReceival, removeReceival, type SavedReceival } from '../lib/persistence';
import { palletSubtotal, productSubtotal } from '../lib/session';
import { exportSessionToXlsx } from '../lib/export';

interface HistoryScreenProps {
  onBack: () => void;
}

/**
 * Past receivals: completed sessions saved on THIS device (IndexedDB). List ->
 * read-only detail with re-export, and delete with confirm. Local only — the
 * Excel export is the durable copy.
 */
export function HistoryScreen({ onBack }: HistoryScreenProps) {
  const [receivals, setReceivals] = useState<SavedReceival[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<Session | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = () => {
    listReceivals()
      .then(setReceivals)
      .catch((err) => {
        console.warn('Failed to list receivals:', err);
        setReceivals([]);
        setNotice('Could not read saved receivals from device storage.');
      });
  };

  useEffect(refresh, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const open = (rec: SavedReceival) => {
    setOpenId(rec.id);
    setOpenSession(null);
    setOpenFailed(false);
    openReceival(rec)
      .then((s) => (s ? setOpenSession(s) : setOpenFailed(true)))
      .catch(() => setOpenFailed(true));
  };

  const doDelete = async (id: string) => {
    try {
      await removeReceival(id);
      setConfirmDeleteId(null);
      if (openId === id) {
        setOpenId(null);
        setOpenSession(null);
      }
      refresh();
    } catch (err) {
      setNotice(`Delete failed: ${String(err)}`);
    }
  };

  const doExport = async (session: Session) => {
    try {
      const filename = await exportSessionToXlsx(session);
      setNotice(`Exported ${filename}`);
    } catch (err) {
      setNotice(`Export failed: ${String(err)}`);
    }
  };

  const openRecord = openId != null ? receivals?.find((r) => r.id === openId) : undefined;

  // ---- detail view ---------------------------------------------------------
  if (openRecord) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-3">
        <header className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setOpenId(null);
              setOpenSession(null);
            }}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-slate-600"
          >
            ‹ History
          </button>
          <div className="min-w-0 flex-1 text-right">
            <div className="truncate text-sm font-semibold text-slate-100">{openRecord.poRef}</div>
            <div className="truncate text-xs text-slate-400">
              {openRecord.supplier}
              {openRecord.brand ? ` · ${openRecord.brand}` : ''} ·{' '}
              {new Date(openRecord.savedAt).toLocaleString()}
            </div>
          </div>
        </header>

        <div className="rounded-2xl bg-slate-800/80 p-4 text-center ring-1 ring-slate-700">
          <div className="text-xs font-medium uppercase tracking-widest text-slate-400">
            PO total (read-only)
          </div>
          <div className="mt-1 font-mono text-4xl font-bold tabular-nums text-emerald-400">
            {openRecord.totalKg.toFixed(2)}
            <span className="ml-2 text-xl text-slate-400">kg</span>
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {openRecord.cartonCount} carton{openRecord.cartonCount === 1 ? '' : 's'}
          </div>
        </div>

        {openFailed ? (
          <div className="rounded-xl bg-amber-500/15 px-3 py-3 text-sm text-amber-200 ring-1 ring-amber-500/40">
            This receival was saved by a different app version and can’t be opened in detail. The
            record is preserved; you can delete it below if it’s no longer needed.
          </div>
        ) : openSession == null ? (
          <div className="py-4 text-center text-sm text-slate-500">Loading…</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {openSession.products.map((p) => {
              const sub = productSubtotal(p);
              return (
                <li key={p.id} className="rounded-xl bg-slate-800/50 p-3 ring-1 ring-slate-700">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-slate-100">{p.product}</span>
                    <span className="shrink-0 font-mono font-bold tabular-nums text-emerald-400">
                      {sub.kg.toFixed(2)} kg
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {sub.count} carton{sub.count === 1 ? '' : 's'} · GTIN {p.gtin || '—'}
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {p.pallets.map((pal) => {
                      const ps = palletSubtotal(pal);
                      return (
                        <li key={pal.id} className="flex justify-between text-xs text-slate-400">
                          <span>
                            Pallet {pal.number}
                            {pal.palletId ? ` · ${pal.palletId}` : ''} · {ps.count} ctn
                          </span>
                          <span className="font-mono tabular-nums">{ps.kg.toFixed(2)} kg</span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}

        {openSession && (
          <button
            type="button"
            data-testid="history-export"
            onClick={() => doExport(openSession)}
            className="rounded-xl bg-sky-500 py-3 text-base font-bold text-slate-900 active:bg-sky-400"
          >
            ⬇ Re-export to Excel
          </button>
        )}

        {confirmDeleteId === openRecord.id ? (
          <div className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
            <p className="text-sm text-rose-200">Delete this receival from the device? This can’t be undone.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-medium text-slate-200"
              >
                Keep
              </button>
              <button
                type="button"
                data-testid="history-delete-confirm"
                onClick={() => doDelete(openRecord.id)}
                className="flex-1 rounded-lg bg-rose-500 py-2 text-sm font-bold text-slate-900"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="history-delete"
            onClick={() => setConfirmDeleteId(openRecord.id)}
            className="rounded-xl bg-rose-500/20 py-3 text-sm font-semibold text-rose-300 ring-1 ring-rose-500/40"
          >
            Delete this receival
          </button>
        )}

        {notice && <p className="text-center text-xs text-slate-400">{notice}</p>}
      </div>
    );
  }

  // ---- list view -----------------------------------------------------------
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-3">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-slate-600"
        >
          ‹ Back
        </button>
        <h1 className="text-lg font-bold">Past receivals</h1>
        <span className="w-14" />
      </header>

      <p className="rounded-xl bg-slate-800/60 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-700">
        Stored on <span className="font-semibold text-slate-300">this device only</span> — not backed
        up to any cloud. The Excel export is the durable copy to keep. Clearing browser data or
        losing the device loses this history.
      </p>

      {receivals == null ? (
        <div className="py-6 text-center text-sm text-slate-500">Loading…</div>
      ) : receivals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          No saved receivals yet. Finish a session to save it here.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {receivals.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                data-testid={`history-item-${r.id}`}
                onClick={() => open(r)}
                className="flex w-full items-center gap-3 rounded-xl bg-slate-800/70 px-3 py-3 text-left ring-1 ring-slate-700 active:bg-slate-700"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-100">{r.poRef}</div>
                  <div className="truncate text-xs text-slate-400">
                    {r.supplier}
                    {r.brand ? ` · ${r.brand}` : ''} · {new Date(r.savedAt).toLocaleString()}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono font-bold tabular-nums text-emerald-400">
                    {r.totalKg.toFixed(2)} kg
                  </div>
                  <div className="text-xs text-slate-400">
                    {r.cartonCount} ctn{r.cartonCount === 1 ? '' : 's'}
                  </div>
                </div>
                <span className="shrink-0 text-slate-500">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice && <p className="text-center text-xs text-slate-400">{notice}</p>}
    </div>
  );
}
