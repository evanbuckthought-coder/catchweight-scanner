import { useState } from 'react';
import {
  exportQuickCount,
  loadSavedQuickCounts,
  removeSavedQuickCount,
  type SavedQuickCount,
} from '../lib/quickCount';

interface QuickCountsListScreenProps {
  onBack: () => void;
}

/** Saved Quick Counts — the scratchpad list kept separate from receival
 *  History. View, re-export (email/share), or delete a saved count. */
export function QuickCountsListScreen({ onBack }: QuickCountsListScreenProps) {
  const [counts, setCounts] = useState<SavedQuickCount[]>(() => loadSavedQuickCounts());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const share = async (q: SavedQuickCount) => {
    setNote('Preparing…');
    try {
      const res = await exportQuickCount(q.entries, { scannedBy: q.scannedBy, when: q.savedAt });
      setNote(
        res === 'shared'
          ? 'Handed to the share sheet.'
          : res === 'downloaded'
            ? 'Sharing unavailable — downloaded instead.'
            : 'Share cancelled.',
      );
    } catch {
      setNote('Couldn’t create the spreadsheet — try again.');
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="saved-back"
          onClick={onBack}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-slate-600"
        >
          ‹ Back
        </button>
        <h1 className="text-lg font-bold">Saved quick counts</h1>
        <span className="w-14" />
      </header>

      <p className="text-xs text-slate-500">
        Weight-only scratchpad counts, kept separate from receival History.
      </p>

      {note && (
        <p data-testid="saved-note" className="rounded-xl bg-slate-800/70 px-3 py-2 text-center text-sm text-slate-200 ring-1 ring-slate-700">
          {note}
        </p>
      )}

      {counts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          No saved quick counts yet. Finish a count and tap “Save on device”.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {counts.map((q) => (
            <li key={q.id} className="rounded-xl bg-slate-800/70 p-3 ring-1 ring-slate-700">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xl font-bold tabular-nums text-emerald-400">
                  {q.totalKg.toFixed(2)} kg
                </span>
                <span className="text-xs text-slate-400">
                  {q.count} item{q.count === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {new Date(q.savedAt).toLocaleString()}
                {q.scannedBy ? ` · ${q.scannedBy}` : ''}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid={`saved-export-${q.id}`}
                  onClick={() => void share(q)}
                  className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-semibold text-slate-900 active:bg-sky-400"
                >
                  ✉ Email / export
                </button>
                {confirmDelete === q.id ? (
                  <div className="flex flex-1 gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-medium text-slate-200"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      data-testid={`saved-delete-confirm-${q.id}`}
                      onClick={() => {
                        setCounts(removeSavedQuickCount(q.id));
                        setConfirmDelete(null);
                      }}
                      className="flex-1 rounded-lg bg-rose-500 py-2 text-sm font-bold text-slate-900"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid={`saved-delete-${q.id}`}
                    onClick={() => setConfirmDelete(q.id)}
                    className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-medium text-rose-300 active:bg-slate-600"
                  >
                    🗑 Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
