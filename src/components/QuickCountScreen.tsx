import { useEffect, useRef, useState } from 'react';
import { ScannerView } from './ScannerView';
import { ManualKeypad } from './ManualKeypad';
import { parseGS1 } from '../lib/gs1';
import { roundKg, toKg, type WeightUnit } from '../lib/units';
import { signalError, signalSuccess } from '../lib/feedback';
import { uid } from '../lib/storage';
import {
  exportQuickCount,
  preloadXlsx,
  quickCountTotalKg,
  type QuickCountEntry,
} from '../lib/quickCount';

interface QuickCountScreenProps {
  scannedBy: string;
  entries: QuickCountEntry[];
  unit: WeightUnit;
  onUnitChange: (unit: WeightUnit) => void;
  onAdd: (entry: QuickCountEntry) => void;
  onRemove: (id: string) => void;
  /** Reset to a fresh count, staying in Quick Count. */
  onClear: () => void;
  /** Discard + return to the main menu. */
  onDiscard: () => void;
  /** Save to the on-device quick-count list + return to the main menu. */
  onSave: () => void;
  /** Back to the main menu, keeping the in-progress count. */
  onExit: () => void;
  onViewSaved: () => void;
  savedCount: number;
}

/** Ignore the same barcode while it stays in view (matches receival guard). */
const REPEAT_WINDOW_MS = 3000;

/**
 * Quick Count: a flat weight-only tally, separate from the formal receival.
 * No PO / supplier / product / pallet structure, no first-carton confirm, no
 * label-change warning, no profiles — scan weight-bearing barcodes or key
 * weights on the same keypad as manual receival entry, and read off a running
 * total. Finishing offers Discard / Save on device / Email spreadsheet.
 */
export function QuickCountScreen({
  scannedBy,
  entries,
  unit,
  onUnitChange,
  onAdd,
  onRemove,
  onClear,
  onDiscard,
  onSave,
  onExit,
  onViewSaved,
  savedCount,
}: QuickCountScreenProps) {
  const [mode, setMode] = useState<'barcode' | 'manual'>('barcode');
  const [view, setView] = useState<'count' | 'finish'>('count');
  const [feedback, setFeedback] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [emailNote, setEmailNote] = useState('');
  const lastDecodeRef = useRef<{ raw: string; time: number }>({ raw: '', time: 0 });

  const total = quickCountTotalKg(entries);

  // Warm the xlsx chunk so Email's share call keeps the iOS user gesture.
  useEffect(() => preloadXlsx(), []);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(''), 3000);
    return () => clearTimeout(t);
  }, [feedback]);

  const addWeight = (netWeight: number, u: WeightUnit, entry: QuickCountEntry['entry']) => {
    onAdd({
      id: uid(),
      netWeight,
      unit: u,
      weightKg: toKg(netWeight, u),
      entry,
      time: new Date().toISOString(),
    });
    signalSuccess();
  };

  const handleDecode = (raw: string) => {
    const now = Date.now();
    if (raw === lastDecodeRef.current.raw && now - lastDecodeRef.current.time < REPEAT_WINDOW_MS) {
      lastDecodeRef.current.time = now;
      return;
    }
    lastDecodeRef.current = { raw, time: now };

    const parsed = parseGS1(raw);
    if (!parsed.valid) {
      signalError();
      setFeedback(parsed.errors[0] ?? 'Couldn’t read that barcode');
      return;
    }
    if (parsed.weightKg == null || parsed.netWeight == null) {
      signalError();
      setFeedback('No weight in that barcode — switch to Manual to key it');
      return;
    }
    addWeight(parsed.netWeight, parsed.weightUnit ?? 'kg', 'scan');
    setFeedback(`+ ${roundKg(parsed.weightKg).toFixed(2)} kg (scanned)`);
  };

  const email = async () => {
    if (entries.length === 0) return;
    setEmailNote('Preparing…');
    try {
      const res = await exportQuickCount(entries, { scannedBy, when: new Date().toISOString() });
      setEmailNote(
        res === 'shared'
          ? 'Handed to the share sheet.'
          : res === 'downloaded'
            ? 'Sharing unavailable — downloaded the file instead.'
            : 'Share cancelled.',
      );
    } catch {
      setEmailNote('Couldn’t create the spreadsheet — try again.');
    }
  };

  const runningTotal = (
    <div className="rounded-2xl bg-slate-800/80 p-4 text-center ring-1 ring-slate-700">
      <div className="text-xs font-medium uppercase tracking-widest text-slate-400">Quick count total</div>
      <div data-testid="quick-total" className="mt-1 font-mono text-5xl font-bold tabular-nums text-emerald-400">
        {total.toFixed(2)}
        <span className="ml-2 text-2xl text-slate-400">kg</span>
      </div>
      <div className="mt-1 text-sm text-slate-300">
        {entries.length} item{entries.length === 1 ? '' : 's'}
      </div>
    </div>
  );

  const header = (
    <header className="flex items-center justify-between gap-2">
      <button
        type="button"
        data-testid="quick-exit"
        onClick={onExit}
        aria-label="Main menu"
        className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-slate-300 ring-1 ring-slate-600"
      >
        ‹
      </button>
      <div className="min-w-0 flex-1 text-center">
        <div className="text-sm font-bold text-slate-100">⚡ Quick Count</div>
        <div className="truncate text-xs text-slate-500">weight tally · not a receival</div>
      </div>
      <button
        type="button"
        data-testid="quick-view-saved"
        onClick={onViewSaved}
        className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 ring-1 ring-slate-600"
      >
        🗂 Saved{savedCount ? ` (${savedCount})` : ''}
      </button>
    </header>
  );

  // ---- Finish view ----------------------------------------------------------
  if (view === 'finish') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-3">
        {header}
        <h1 className="text-lg font-bold">Finish quick count</h1>
        {runningTotal}

        {emailNote && (
          <p data-testid="quick-email-note" className="rounded-xl bg-slate-800/70 px-3 py-2 text-center text-sm text-slate-200 ring-1 ring-slate-700">
            {emailNote}
          </p>
        )}

        <button
          type="button"
          data-testid="quick-email"
          disabled={entries.length === 0}
          onClick={() => void email()}
          className="rounded-xl bg-sky-500 py-3.5 text-base font-bold text-slate-900 active:bg-sky-400 disabled:opacity-40"
        >
          ✉ Email spreadsheet
        </button>

        <button
          type="button"
          data-testid="quick-save"
          disabled={entries.length === 0}
          onClick={onSave}
          className="rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
        >
          💾 Save on device
        </button>

        {!confirmDiscard ? (
          <button
            type="button"
            data-testid="quick-discard"
            onClick={() => setConfirmDiscard(true)}
            className="rounded-xl bg-rose-500/20 py-3.5 text-base font-semibold text-rose-300 ring-1 ring-rose-500/40"
          >
            🗑 Discard
          </button>
        ) : (
          <div className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
            <p className="text-sm text-rose-200">Discard this count? It won’t be saved.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-slate-200"
              >
                Keep
              </button>
              <button
                type="button"
                data-testid="quick-discard-confirm"
                onClick={onDiscard}
                className="flex-1 rounded-lg bg-rose-500 py-2.5 text-sm font-bold text-slate-900"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setConfirmDiscard(false);
            setEmailNote('');
            setView('count');
          }}
          className="mt-auto rounded-xl bg-slate-800 py-3 text-sm font-semibold text-slate-300 ring-1 ring-slate-600"
        >
          ‹ Back to counting
        </button>
      </div>
    );
  }

  // ---- Count view -----------------------------------------------------------
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-3">
      {header}
      {runningTotal}

      {mode === 'barcode' ? (
        <ScannerView active paused={false} mode="barcode" onDecode={handleDecode} onOcrRead={() => {}} />
      ) : (
        <ManualKeypad
          unit={unit}
          onUnitChange={onUnitChange}
          onCommit={(netWeight, u) => addWeight(netWeight, u, 'manual')}
          enterLabel="⏎ ENTER — add weight"
        />
      )}

      {feedback && (
        <div
          data-testid="quick-feedback"
          className="rounded-lg bg-slate-800/70 px-3 py-1.5 text-center text-sm font-medium text-slate-200 ring-1 ring-slate-700"
        >
          {feedback}
        </div>
      )}

      <div className="flex overflow-hidden rounded-xl text-sm font-semibold ring-1 ring-slate-600">
        <button
          type="button"
          data-testid="quick-mode-barcode"
          onClick={() => setMode('barcode')}
          className={`flex-1 py-2.5 ${mode === 'barcode' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
        >
          ▮▯ Barcode
        </button>
        <button
          type="button"
          data-testid="quick-mode-manual"
          onClick={() => setMode('manual')}
          className={`flex-1 py-2.5 ${mode === 'manual' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
        >
          ✎ Manual entry
        </button>
      </div>

      {/* Entry list (newest first) with remove */}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          {mode === 'barcode'
            ? 'Scan a weight-bearing barcode to add it to the total.'
            : 'Key a weight and tap ENTER to add it to the total.'}
        </div>
      ) : (
        <ul data-testid="quick-list" className="flex flex-col gap-1.5">
          {entries
            .slice()
            .reverse()
            .map((e, i) => (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-xl bg-slate-800/70 px-3 py-2 ring-1 ring-slate-700"
              >
                <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-500">
                  {entries.length - i}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-mono font-semibold tabular-nums text-slate-100">
                    {roundKg(e.weightKg).toFixed(2)} kg
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    {e.unit === 'lb' ? `${e.netWeight} lb · ` : ''}
                    {e.entry === 'scan' ? 'scanned' : 'manual'}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`quick-remove-${e.id}`}
                  onClick={() => onRemove(e.id)}
                  aria-label="Remove"
                  className="shrink-0 rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-rose-300 active:bg-slate-600"
                >
                  ✕
                </button>
              </li>
            ))}
        </ul>
      )}

      {/* New count + Finish */}
      <div className="mt-1 flex gap-2">
        {!confirmNew ? (
          <button
            type="button"
            data-testid="quick-new"
            onClick={() => (entries.length ? setConfirmNew(true) : onClear())}
            className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-semibold text-slate-300 ring-1 ring-slate-600 active:bg-slate-700"
          >
            ↻ New count
          </button>
        ) : (
          <div className="flex-1 rounded-xl bg-slate-800 p-2 ring-1 ring-slate-600">
            <p className="px-1 text-xs text-slate-300">Reset and start fresh?</p>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmNew(false)}
                className="flex-1 rounded-lg bg-slate-700 py-2 text-xs font-medium text-slate-200"
              >
                Keep
              </button>
              <button
                type="button"
                data-testid="quick-new-confirm"
                onClick={() => {
                  setConfirmNew(false);
                  onClear();
                }}
                className="flex-1 rounded-lg bg-rose-500 py-2 text-xs font-bold text-slate-900"
              >
                Reset
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          data-testid="quick-finish"
          disabled={entries.length === 0}
          onClick={() => setView('finish')}
          className="flex-1 rounded-xl bg-sky-500 py-3 text-base font-bold text-slate-900 active:bg-sky-400 disabled:opacity-40"
        >
          Finish ▸
        </button>
      </div>
    </div>
  );
}
