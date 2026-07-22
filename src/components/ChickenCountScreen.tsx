import { useEffect, useRef, useState } from 'react';
import { ScannerView } from './ScannerView';
import { ChickenPackSheet } from './ChickenPackSheet';
import { ChickenTeachFlow } from './ChickenTeachFlow';
import { parseGS1, type ParsedCarton } from '../lib/gs1';
import { getProfile } from '../lib/profiles';
import { roundKg } from '../lib/units';
import { signalError, signalSuccess } from '../lib/feedback';
import {
  chickenByProduct,
  chickenTotalKg,
  entryFromPack,
  entryKg,
  exportChickenCount,
  loadChickenPacks,
  materializeEntries,
  preloadXlsx,
  resolveChickenScan,
  upsertChickenPack,
  type ChickenEntry,
  type ChickenProductRow,
} from '../lib/chicken';

interface ChickenCountScreenProps {
  scannedBy: string;
  entries: ChickenEntry[];
  onAdd: (entry: ChickenEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onExit: () => void;
  onViewSaved: () => void;
  savedCount: number;
}

/** Ignore the same barcode while it stays in view. */
const REPEAT_WINDOW_MS = 3000;

/**
 * Fresh Chicken — a standalone carton tally for chicken barcodes.
 * Random-weight labels (net weight in the barcode) capture each carton's
 * actual weight; set-weight products COUNT CARTONS — the set weight is taught
 * once and kg is DERIVED (cartons × set weight), so editing the set weight in
 * Label Intelligence updates the totals. Everything the barcode carries
 * (GTIN, dates, batch, serial) is recorded.
 * No PO / supplier / pallets — finish with Discard / Save / Email.
 */
export function ChickenCountScreen({
  scannedBy,
  entries,
  onAdd,
  onRemove,
  onClear,
  onDiscard,
  onSave,
  onExit,
  onViewSaved,
  savedCount,
}: ChickenCountScreenProps) {
  const [view, setView] = useState<'count' | 'finish'>('count');
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState<{ parsed: ParsedCarton; gtin: string } | null>(null);
  /** AI teach flow — from the header (learn ahead) or the first-scan prompt. */
  const [teaching, setTeaching] = useState<{
    gtin?: string;
    parsed?: ParsedCarton;
    /** Count the carton that triggered the prompt once the label is taught. */
    countAfter?: ParsedCarton;
  } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [emailNote, setEmailNote] = useState('');
  const lastDecodeRef = useRef<{ raw: string; time: number }>({ raw: '', time: 0 });
  /** Set synchronously so two decodes in one frame can't both open the sheet. */
  const sheetGateRef = useRef(false);

  // Loaded per render so a set weight edited in Label Intelligence flows
  // straight into the derived totals (set kg = cartons × current set weight).
  const packs = loadChickenPacks();
  const total = chickenTotalKg(entries, packs);
  const byProduct = chickenByProduct(entries, packs);

  useEffect(() => preloadXlsx(), []);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [feedback]);

  const handleDecode = (raw: string) => {
    if (sheetGateRef.current) return;
    const now = Date.now();
    if (raw === lastDecodeRef.current.raw && now - lastDecodeRef.current.time < REPEAT_WINDOW_MS) {
      lastDecodeRef.current.time = now;
      return;
    }
    lastDecodeRef.current = { raw, time: now };

    const parsed = parseGS1(raw);
    const outcome = resolveChickenScan(parsed, entries);

    switch (outcome.kind) {
      case 'not-gs1':
        signalError();
        // These labels also carry a Lot ID and an internal code — only the
        // GS1 one (starting 01 / "(01)") has the GTIN.
        setFeedback({ text: 'Not the GS1 barcode — scan the one starting (01)', ok: false });
        return;
      case 'duplicate':
        signalError();
        setFeedback({ text: `Already counted · serial ${outcome.serial}`, ok: false });
        return;
      case 'needs-pack':
        sheetGateRef.current = true;
        setPending({ parsed: outcome.parsed, gtin: outcome.gtin });
        return;
      case 'counted': {
        // A random-weight product never passes through the pack sheet, so it
        // has no learned name — fall back to one the app already knows from a
        // previous receival of the same GTIN.
        const e =
          outcome.entry.product === ''
            ? { ...outcome.entry, product: getProfile(outcome.entry.gtin)?.productName ?? '' }
            : outcome.entry;
        onAdd(e);
        signalSuccess();
        // Cartons are the primary figure — lead with the count.
        if (e.weightSource === 'barcode') {
          setFeedback({
            text: `+1 carton · ${roundKg(e.weightKg).toFixed(2)} kg${e.product ? ` · ${e.product}` : ''}`,
            ok: true,
          });
        } else {
          const ctns = entries.filter((x) => x.gtin === e.gtin).length + 1;
          setFeedback({
            text: `✓ Carton counted · ${e.product || `GTIN ${e.gtin}`} (${ctns} ctn)`,
            ok: true,
          });
        }
        return;
      }
    }
  };

  const savePack = (product: string, packKg: number | null) => {
    if (!pending) return;
    const profile = {
      gtin: pending.gtin,
      product,
      type: 'set' as const,
      packKg,
      updatedAt: new Date().toISOString(),
    };
    upsertChickenPack(profile);
    onAdd(entryFromPack(pending.parsed, profile));
    signalSuccess();
    setFeedback({
      text:
        packKg == null
          ? `✓ Carton counted (count only — no kg)`
          : `✓ Carton counted · set weight saved (${packKg} kg/ctn)`,
      ok: true,
    });
    setPending(null);
    sheetGateRef.current = false;
  };

  const email = async () => {
    if (entries.length === 0) return;
    setEmailNote('Preparing…');
    try {
      // Bake the derived set-weight kg in, so the emailed sheet is a stable
      // snapshot of what was on screen.
      const res = await exportChickenCount(materializeEntries(entries, packs), {
        scannedBy,
        when: new Date().toISOString(),
      });
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
      <div className="text-xs font-medium uppercase tracking-widest text-slate-400">Fresh chicken count</div>
      <div className="mt-1 flex items-baseline justify-center gap-4">
        <div>
          <span data-testid="chicken-cartons" className="font-mono text-5xl font-bold tabular-nums text-amber-300">
            {entries.length}
          </span>
          <span className="ml-1 text-lg text-slate-400">ctn</span>
        </div>
        <div>
          <span data-testid="chicken-total" className="font-mono text-3xl font-bold tabular-nums text-emerald-400">
            {total.toFixed(2)}
          </span>
          <span className="ml-1 text-base text-slate-400">kg</span>
        </div>
      </div>
    </div>
  );

  /** Per-product breakdown — cartons primary, kg derived for set / summed for random. */
  const productRow = (p: ChickenProductRow) => (
    <li key={p.gtin} className="rounded-xl bg-slate-800/70 px-3 py-2 ring-1 ring-slate-700">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
            p.type === 'set' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-sky-500/20 text-sky-300'
          }`}
        >
          {p.type === 'set' ? 'SET' : 'RANDOM'}
        </span>
        <span className="min-w-0 flex-1 truncate text-slate-200">{p.product || `GTIN ${p.gtin}`}</span>
        <span className="shrink-0 font-mono font-bold tabular-nums text-amber-300">{p.cartons} ctn</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {p.type === 'set'
            ? p.setKg != null
              ? `${p.cartons} × ${p.setKg} kg set weight`
              : 'count only — no kg'
            : 'weighed per carton'}
        </span>
        <span className="font-mono tabular-nums text-emerald-400">{p.kg.toFixed(2)} kg</span>
      </div>
    </li>
  );

  const header = (
    <header className="flex items-center justify-between gap-2">
      <button
        type="button"
        data-testid="chicken-exit"
        onClick={onExit}
        aria-label="Main menu"
        className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-slate-300 ring-1 ring-slate-600"
      >
        ‹
      </button>
      <div className="min-w-0 flex-1 text-center">
        <div className="text-sm font-bold text-slate-100">🐔 Fresh Chicken</div>
        <div className="truncate text-xs text-slate-500">carton tally · not a receival</div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          type="button"
          data-testid="chicken-teach-open"
          onClick={() => {
            sheetGateRef.current = true;
            setTeaching({});
          }}
          className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 ring-1 ring-slate-600"
        >
          📷 Teach
        </button>
        <button
          type="button"
          data-testid="chicken-view-saved"
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
        <h1 className="text-lg font-bold">Finish chicken count</h1>
        {runningTotal}

        {byProduct.length > 0 && (
          <ul className="flex flex-col gap-1.5">{byProduct.map(productRow)}</ul>
        )}

        {emailNote && (
          <p data-testid="chicken-email-note" className="rounded-xl bg-slate-800/70 px-3 py-2 text-center text-sm text-slate-200 ring-1 ring-slate-700">
            {emailNote}
          </p>
        )}

        <button
          type="button"
          data-testid="chicken-email"
          disabled={entries.length === 0}
          onClick={() => void email()}
          className="rounded-xl bg-sky-500 py-3.5 text-base font-bold text-slate-900 active:bg-sky-400 disabled:opacity-40"
        >
          ✉ Email spreadsheet
        </button>

        <button
          type="button"
          data-testid="chicken-save"
          disabled={entries.length === 0}
          onClick={onSave}
          className="rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
        >
          💾 Save on device
        </button>

        {!confirmDiscard ? (
          <button
            type="button"
            data-testid="chicken-discard"
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
                data-testid="chicken-discard-confirm"
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

      <ScannerView
        active
        paused={!!pending || !!teaching}
        mode="barcode"
        onDecode={handleDecode}
        onOcrRead={() => {}}
      />

      {feedback && (
        <div
          data-testid="chicken-feedback"
          className={`rounded-lg px-3 py-1.5 text-center text-sm font-semibold ring-1 ${
            feedback.ok
              ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
              : 'bg-amber-500/15 text-amber-200 ring-amber-500/40'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {byProduct.length > 0 && (
        <ul data-testid="chicken-by-product" className="flex flex-col gap-1.5">
          {byProduct.map(productRow)}
        </ul>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          Scan a chicken carton barcode — the GS1 one starting (01). Set-weight products count
          cartons (kg is worked out from the set weight); random-weight cartons capture their
          actual weight.
        </div>
      ) : (
        <ul data-testid="chicken-list" className="flex flex-col gap-1.5">
          {entries
            .slice()
            .reverse()
            .map((e, i) => {
              const kg = entryKg(e, packs);
              const isBarcode = e.weightSource === 'barcode';
              return (
              <li key={e.id} className="flex items-center gap-3 rounded-xl bg-slate-800/70 px-3 py-2 ring-1 ring-slate-700">
                <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-500">
                  {entries.length - i}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">
                    <span className="font-mono font-semibold tabular-nums">
                      {kg > 0 ? `${roundKg(kg).toFixed(2)} kg ` : '— '}
                    </span>
                    <span className="text-slate-400">{e.product || `GTIN ${e.gtin}`}</span>
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {isBarcode ? 'random wt' : kg > 0 ? 'set wt' : 'count only'}
                    {e.bestBefore ? ` · BB ${e.bestBefore}` : ''}
                    {e.useBy ? ` · use by ${e.useBy}` : ''}
                    {e.serial ? ` · #${e.serial}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`chicken-remove-${e.id}`}
                  onClick={() => onRemove(e.id)}
                  aria-label="Remove"
                  className="shrink-0 rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-rose-300 active:bg-slate-600"
                >
                  ✕
                </button>
              </li>
              );
            })}
        </ul>
      )}

      <div className="mt-1 flex gap-2">
        {!confirmNew ? (
          <button
            type="button"
            data-testid="chicken-new"
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
                data-testid="chicken-new-confirm"
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
          data-testid="chicken-finish"
          disabled={entries.length === 0}
          onClick={() => setView('finish')}
          className="flex-1 rounded-xl bg-sky-500 py-3 text-base font-bold text-slate-900 active:bg-sky-400 disabled:opacity-40"
        >
          Finish ▸
        </button>
      </div>

      {pending && !teaching && (
        <ChickenPackSheet
          gtin={pending.gtin}
          parsed={pending.parsed}
          onSave={savePack}
          onTeachWithAi={() => setTeaching({ gtin: pending.gtin, parsed: pending.parsed, countAfter: pending.parsed })}
          onCancel={() => {
            setPending(null);
            sheetGateRef.current = false;
          }}
        />
      )}

      {teaching && (
        <ChickenTeachFlow
          initialGtin={teaching.gtin}
          initialParsed={teaching.parsed}
          initialType={teaching.gtin ? 'set' : undefined}
          onSaved={(profile) => {
            // Learned mid-count: count the carton that raised the prompt.
            if (teaching.countAfter && profile.type === 'set') {
              onAdd(entryFromPack(teaching.countAfter, profile));
              signalSuccess();
              setFeedback({
                text: `✓ Carton counted · ${profile.product}${
                  profile.packKg != null ? ` (${profile.packKg} kg/ctn)` : ''
                }`,
                ok: true,
              });
            } else {
              setFeedback({ text: `Learned “${profile.product}” — ready to scan`, ok: true });
            }
            setTeaching(null);
            setPending(null);
            sheetGateRef.current = false;
          }}
          onCancel={() => {
            setTeaching(null);
            // Keep the pack prompt open if a scan raised it, so the carton
            // isn't silently dropped.
            if (!teaching.countAfter) {
              setPending(null);
              sheetGateRef.current = false;
            }
          }}
        />
      )}
    </div>
  );
}
