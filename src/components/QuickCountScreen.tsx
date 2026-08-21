import { useEffect, useRef, useState } from 'react';
import { ScannerView } from './ScannerView';
import { ManualKeypad } from './ManualKeypad';
import { cartonKey } from '../lib/gs1';
import { parseScan } from '../lib/scan';
import { isMapConfirmedThisSession, type DecodedBarcode, type SavedBarcodeMap } from '../lib/barcodeMaps';
import { BarcodeTeachFlow } from './BarcodeTeachFlow';
import { BarcodeConfirmSheet } from './BarcodeConfirmSheet';
import { createScanGate } from '../lib/scanGate';
import { roundKg, toKg, type WeightUnit } from '../lib/units';
import { signalError, signalSuccess } from '../lib/feedback';
import { uid } from '../lib/storage';
import {
  exportQuickCount,
  findQuickDuplicate,
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
  /** An unreadable barcode awaiting "Analyse with AI" / manual entry. */
  const [teachRaw, setTeachRaw] = useState<{ raw: string; reason: string } | null>(null);
  /** A saved-format decode awaiting this run's one-off human confirmation. */
  const [confirmMap, setConfirmMap] = useState<{
    decoded: DecodedBarcode;
    map: SavedBarcodeMap;
    raw: string;
  } | null>(null);
  const scanGateRef = useRef(createScanGate(REPEAT_WINDOW_MS));

  const total = quickCountTotalKg(entries);

  // Warm the xlsx chunk so Email's share call keeps the iOS user gesture.
  useEffect(() => preloadXlsx(), []);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(''), 3000);
    return () => clearTimeout(t);
  }, [feedback]);

  const addWeight = (
    netWeight: number,
    u: WeightUnit,
    entry: QuickCountEntry['entry'],
    scanInfo?: { gtin?: string; serial?: string; raw: string },
  ) => {
    onAdd({
      id: uid(),
      netWeight,
      unit: u,
      weightKg: toKg(netWeight, u),
      entry,
      time: new Date().toISOString(),
      ...scanInfo,
    });
    signalSuccess();
  };

  /** Add a scanned carton after all guards have passed. */
  const countScan = (
    raw: string,
    netWeight: number,
    unit: WeightUnit,
    weightKg: number,
    key: string | undefined,
    serial: string | undefined,
    note = '',
  ) => {
    // Same-carton flag (mirrors the receival flow): a serial match or an
    // identical full barcode means this carton is already in the list.
    const dup = findQuickDuplicate(entries, { gtin: key, serial, raw });
    if (dup) {
      signalError();
      setFeedback(
        serial
          ? `⚠ Already scanned — serial ${serial}. ✕ it in the list if that’s wrong.`
          : '⚠ Already scanned — identical barcode. ✕ it in the list if that’s wrong.',
      );
      return;
    }
    addWeight(netWeight, unit, 'scan', { gtin: key, serial, raw });
    setFeedback(`+ ${roundKg(weightKg).toFixed(2)} kg (scanned${note})`);
  };

  const handleDecode = (raw: string) => {
    if (teachRaw || confirmMap) return;
    // Per-barcode sliding repeat window — see lib/scanGate.ts for why it
    // must be per raw (labels can carry several readable barcodes).
    if (!scanGateRef.current.admit(raw)) return;

    // GS1 first; an AI-taught custom format only as a fallback (lib/scan.ts).
    const res = parseScan(raw);

    if (res.kind === 'refused') {
      signalError();
      setFeedback(`⚠ ${res.reason}`);
      return;
    }
    if (res.kind === 'ambiguous') {
      signalError();
      setFeedback('⚠ Two saved barcode formats match this — delete one in Label Intelligence, or key it manually.');
      return;
    }
    if (res.kind === 'unreadable') {
      signalError();
      setTeachRaw({ raw, reason: res.reason });
      return;
    }

    const { parsed } = res;
    if (parsed.weightKg == null || parsed.netWeight == null) {
      signalError();
      setFeedback('No weight in that barcode — switch to Manual to key it');
      return;
    }
    // A custom format taught in an earlier session gets one human check per
    // run before it's trusted for the rest of the shift.
    if (res.map && res.decoded && !isMapConfirmedThisSession(res.map.id)) {
      setConfirmMap({ decoded: res.decoded, map: res.map, raw });
      return;
    }
    countScan(
      raw,
      parsed.netWeight,
      parsed.weightUnit ?? 'kg',
      parsed.weightKg,
      cartonKey(parsed),
      parsed.serial,
      parsed.format === 'custom' ? ' · custom format' : '',
    );
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
      <div className="flex shrink-0 gap-1.5">
        {/* Direct way in when a barcode plainly won't scan — no need to fail
            repeatedly first. */}
        <button
          type="button"
          data-testid="quick-analyse"
          onClick={() => setTeachRaw({ raw: '', reason: '' })}
          className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-indigo-300 ring-1 ring-slate-600"
        >
          🤖 Analyse
        </button>
        <button
          type="button"
          data-testid="quick-view-saved"
          onClick={onViewSaved}
          className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 ring-1 ring-slate-600"
        >
          🗂 Saved{savedCount ? ` (${savedCount})` : ''}
        </button>
      </div>
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
        <ScannerView
          active
          paused={!!teachRaw || !!confirmMap}
          mode="barcode"
          onDecode={handleDecode}
          onOcrRead={() => {}}
        />
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
                    {e.entry === 'scan' ? 'scanned' : e.entry === 'ai' ? 'AI photo · confirmed' : 'manual'}
                  </span>
                  {/* Carton ID on the row: two cartons of the same product can
                      genuinely weigh the same, so the serial is the only way to
                      tell "two cartons" from "one scanned twice" at a glance. */}
                  {e.entry === 'scan' && (
                    <div className="truncate text-[11px] text-slate-500">
                      {e.serial ? (
                        <span className="font-mono">#{e.serial}</span>
                      ) : e.raw ? (
                        <span className="text-slate-600">no carton ID on this barcode</span>
                      ) : (
                        <span className="text-amber-500/80">no carton ID recorded — can’t re-scan check</span>
                      )}
                    </div>
                  )}
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

      {teachRaw && (
        <BarcodeTeachFlow
          raw={teachRaw.raw}
          reason={teachRaw.reason}
          onCartonRead={(carton) => {
            // Unscannable label: AI read it, human confirmed it. Recorded as
            // AI-assisted — never as a scan — and it teaches nothing.
            addWeight(carton.netWeight, carton.unit, 'ai');
            setFeedback(`+ ${roundKg(carton.weightKg).toFixed(2)} kg (AI photo, confirmed)`);
            setTeachRaw(null);
          }}
          onSaved={(decoded, map) => {
            countScan(
              teachRaw.raw,
              decoded.unit === 'kg' ? decoded.weightKg : decoded.netWeight,
              decoded.unit,
              decoded.weightKg,
              decoded.productCode,
              decoded.serial,
              ` · ${map.formatName}`,
            );
            setTeachRaw(null);
          }}
          onManual={() => {
            setTeachRaw(null);
            setMode('manual');
            setFeedback('Key the weight below.');
          }}
          onCancel={() => setTeachRaw(null)}
        />
      )}

      {confirmMap && (
        <BarcodeConfirmSheet
          decoded={confirmMap.decoded}
          map={confirmMap.map}
          onAccept={() => {
            const { decoded, raw } = confirmMap;
            countScan(
              raw,
              decoded.unit === 'kg' ? decoded.weightKg : decoded.netWeight,
              decoded.unit,
              decoded.weightKg,
              decoded.productCode,
              decoded.serial,
              ' · custom format',
            );
            setConfirmMap(null);
          }}
          onReject={() => {
            setConfirmMap(null);
            setMode('manual');
            setFeedback('Not counted — key the weight below.');
          }}
        />
      )}
    </div>
  );
}
