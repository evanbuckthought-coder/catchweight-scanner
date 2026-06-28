import { useCallback, useEffect, useRef, useState } from 'react';
import type { GtinProfile, Session } from './types';
import { parseGS1 } from './lib/gs1';
import { roundKg, toKg } from './lib/units';
import { STORAGE_KEYS, uid } from './lib/storage';
import { loadProfiles, upsertProfile } from './lib/profiles';
import { allCartons, findDuplicate, poTotals, totalKg } from './lib/session';
import { toCartonRecord, toManualCartonRecord, type ManualEntryInput } from './lib/carton';
import { exportSessionToXlsx } from './lib/export';
import { signalSuccess, signalError } from './lib/feedback';
import { useLocalStorage } from './hooks/useLocalStorage';

import { SetupScreen } from './components/SetupScreen';
import { SessionSetup } from './components/SessionSetup';
import { ScannerView } from './components/ScannerView';
import { Readout } from './components/Readout';
import { CartonList } from './components/CartonList';
import { DevPanel } from './components/DevPanel';
import { SettingsMenu } from './components/SettingsMenu';
import { SummaryScreen } from './components/SummaryScreen';
import { ConfirmSheet, type PendingConfirm } from './components/ConfirmSheet';
import { LabelChangeSheet } from './components/LabelChangeSheet';
import { ManualEntrySheet } from './components/ManualEntrySheet';

type ToastKind = 'info' | 'warn' | 'error';
interface Toast {
  text: string;
  kind: ToastKind;
}

/** A scanned carton that differs from the active product's label. */
interface LabelIssue {
  parsed: ReturnType<typeof parseGS1>;
}

/** Ignore the identical decoded string if it repeats within this window. */
const REPEAT_WINDOW_MS = 3000;

export default function App() {
  const [scannedBy, setScannedBy] = useLocalStorage<string>(STORAGE_KEYS.scannedBy, '');
  const [session, setSession] = useLocalStorage<Session | null>(STORAGE_KEYS.session, null);
  const [profiles, setProfiles] = useState<Record<string, GtinProfile>>(() => loadProfiles());

  const [view, setView] = useState<'scan' | 'summary'>('scan');
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [labelIssue, setLabelIssue] = useState<LabelIssue | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const lastDecodeRef = useRef<{ raw: string; time: number }>({ raw: '', time: 0 });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((text: string, kind: ToastKind = 'info') => {
    setToast({ text, kind });
  }, []);

  // --- counting -----------------------------------------------------------

  /** Append a scanned carton to a product (immutably) + success feedback. */
  const commitCarton = useCallback(
    (productId: string, parsed: ReturnType<typeof parseGS1>, productName: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const record = toCartonRecord(parsed, {
          scannedBy,
          poRef: prev.poRef,
          supplier: prev.supplier,
          brand: prev.brand,
          product: productName,
        });
        return {
          ...prev,
          products: prev.products.map((p) =>
            p.id === productId ? { ...p, cartons: [...p.cartons, record] } : p,
          ),
        };
      });
      signalSuccess();
      showToast(`Counted ${productName} · ${roundKg(parsed.weightKg ?? 0).toFixed(2)} kg`, 'info');
    },
    [scannedBy, setSession, showToast],
  );

  /** Single entry point for camera decodes and simulated/manual scans. */
  const handleDecode = useCallback(
    (raw: string) => {
      if (!session || pending || labelIssue || manualOpen || view === 'summary') return;

      const now = Date.now();
      if (raw === lastDecodeRef.current.raw && now - lastDecodeRef.current.time < REPEAT_WINDOW_MS) {
        return;
      }
      lastDecodeRef.current = { raw, time: now };

      const parsed = parseGS1(raw);
      if (!parsed.valid) {
        signalError();
        showToast(parsed.errors[0] ?? 'Could not parse label', 'error');
        return;
      }
      const gtin = parsed.gtin!;

      if (findDuplicate(allCartons(session), gtin, parsed.traceId)) {
        signalError();
        showToast(`Already scanned · ${parsed.traceAI === '10' ? 'batch' : 'serial'} ${parsed.traceId}`, 'warn');
        return;
      }

      const active = session.products.find((p) => p.id === session.activeProductId) ?? null;

      // No active product -> this is the first carton of a (new) product.
      if (!active) {
        const profile = profiles[gtin];
        setPending({ parsed, product: profile?.productName ?? '', isNewGtin: !profile });
        return;
      }

      // Active product, but the label differs -> label-change warning.
      if (parsed.gtin !== active.gtin || parsed.fingerprint !== active.fingerprint) {
        setLabelIssue({ parsed });
        return;
      }

      // Same product, not the first carton -> straight to the tally.
      commitCarton(active.id, parsed, active.product);
    },
    [session, pending, labelIssue, manualOpen, view, profiles, commitCarton, showToast],
  );

  /** Confirm the first carton of a new product (creates the product group). */
  const confirmPending = useCallback(
    (productName: string) => {
      if (!pending) return;
      const { parsed } = pending;
      const gtin = parsed.gtin!;
      const newId = uid();
      setSession((prev) => {
        if (!prev) return prev;
        const record = toCartonRecord(parsed, {
          scannedBy,
          poRef: prev.poRef,
          supplier: prev.supplier,
          brand: prev.brand,
          product: productName,
        });
        return {
          ...prev,
          products: [
            ...prev.products,
            {
              id: newId,
              product: productName,
              gtin,
              fingerprint: parsed.fingerprint ?? '',
              startedAt: new Date().toISOString(),
              cartons: [record],
            },
          ],
          activeProductId: newId,
        };
      });
      setProfiles(
        upsertProfile({
          gtin,
          productName,
          supplierName: session?.supplier ?? '',
          fingerprint: parsed.fingerprint ?? '',
          updatedAt: new Date().toISOString(),
        }),
      );
      signalSuccess();
      showToast(`Counted ${productName} · ${roundKg(parsed.weightKg ?? 0).toFixed(2)} kg`, 'info');
      setPending(null);
    },
    [pending, scannedBy, session, setSession, showToast],
  );

  // --- label-change resolutions -------------------------------------------

  const labelAddAnyway = useCallback(() => {
    if (!labelIssue || !session) return;
    const active = session.products.find((p) => p.id === session.activeProductId);
    if (active) commitCarton(active.id, labelIssue.parsed, active.product);
    setLabelIssue(null);
  }, [labelIssue, session, commitCarton]);

  const labelCancel = useCallback(() => setLabelIssue(null), []);

  const labelNextProduct = useCallback(() => {
    if (!labelIssue) return;
    const { parsed } = labelIssue;
    const gtin = parsed.gtin!;
    const profile = profiles[gtin];
    setSession((prev) => (prev ? { ...prev, activeProductId: null } : prev));
    setLabelIssue(null);
    setPending({ parsed, product: profile?.productName ?? '', isNewGtin: !profile });
  }, [labelIssue, profiles, setSession]);

  // --- product / session controls -----------------------------------------

  const nextProduct = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, activeProductId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
  }, [setSession]);

  const addManualCarton = useCallback(
    (input: ManualEntryInput) => {
      setSession((prev) => {
        if (!prev) return prev;
        const active = prev.products.find((p) => p.id === prev.activeProductId);
        if (!active) return prev;
        const record = toManualCartonRecord(input, {
          scannedBy,
          poRef: prev.poRef,
          supplier: prev.supplier,
          brand: prev.brand,
          product: active.product,
          gtin: active.gtin,
        });
        return {
          ...prev,
          products: prev.products.map((p) =>
            p.id === active.id ? { ...p, cartons: [...p.cartons, record] } : p,
          ),
        };
      });
      signalSuccess();
      showToast(`Added ${roundKg(toKg(input.netWeight, input.unit)).toFixed(2)} kg (manual)`, 'info');
      setManualOpen(false);
    },
    [scannedBy, setSession, showToast],
  );

  /** Remove a carton from whichever product holds it; prune empty products. */
  const removeCarton = useCallback(
    (cartonId: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const products = prev.products
          .map((p) => ({ ...p, cartons: p.cartons.filter((c) => c.id !== cartonId) }))
          .filter((p) => p.cartons.length > 0);
        const activeStillExists = products.some((p) => p.id === prev.activeProductId);
        return { ...prev, products, activeProductId: activeStillExists ? prev.activeProductId : null };
      });
    },
    [setSession],
  );

  const startSession = useCallback(
    (poRef: string, supplier: string, brand: string | undefined) => {
      setSession({
        id: uid(),
        poRef,
        supplier,
        brand,
        startedAt: new Date().toISOString(),
        scannedBy,
        products: [],
        activeProductId: null,
      });
      setView('scan');
    },
    [scannedBy, setSession],
  );

  const endSession = useCallback(() => {
    setSession(null);
    setSettingsOpen(false);
    setView('scan');
    lastDecodeRef.current = { raw: '', time: 0 };
  }, [setSession]);

  const handleExport = useCallback(async () => {
    if (!session || allCartons(session).length === 0) {
      showToast('Nothing to export yet', 'warn');
      return;
    }
    try {
      const filename = await exportSessionToXlsx(session);
      showToast(`Exported ${filename}`, 'info');
    } catch (err) {
      showToast(`Export failed: ${String(err)}`, 'error');
    }
  }, [session, showToast]);

  const amendProduct = useCallback(
    (productId: string) => {
      setSession((prev) => (prev ? { ...prev, activeProductId: productId } : prev));
      lastDecodeRef.current = { raw: '', time: 0 };
      setView('scan');
    },
    [setSession],
  );

  const captureNewProduct = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, activeProductId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
    setView('scan');
  }, [setSession]);

  // --- screens ------------------------------------------------------------

  if (!scannedBy || editingName) {
    return (
      <SetupScreen
        initialName={scannedBy}
        onSave={(name) => {
          setScannedBy(name);
          setEditingName(false);
        }}
      />
    );
  }

  if (!session) {
    return (
      <SessionSetup scannedBy={scannedBy} onStart={startSession} onEditName={() => setEditingName(true)} />
    );
  }

  if (view === 'summary') {
    return (
      <SummaryScreen
        session={session}
        onAmendProduct={amendProduct}
        onCaptureNewProduct={captureNewProduct}
        onBackToScan={() => setView('scan')}
        onExport={handleExport}
        onEndSession={endSession}
      />
    );
  }

  const activeProduct = session.products.find((p) => p.id === session.activeProductId) ?? null;
  const totals = poTotals(session);
  const productKg = activeProduct ? totalKg(activeProduct.cartons) : 0;
  const productCount = activeProduct ? activeProduct.cartons.length : 0;
  const currentBatch = activeProduct?.cartons.at(-1)?.batch;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-3">
      <header className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{session.poRef}</div>
          <div className="truncate text-xs text-slate-400">
            {session.supplier}
            {session.brand ? ` · ${session.brand}` : ''} · {scannedBy}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="rounded-lg bg-slate-800 px-3 py-2 text-slate-300 ring-1 ring-slate-600"
        >
          ⚙
        </button>
      </header>

      <ScannerView active paused={!!pending || !!labelIssue || manualOpen} onDecode={handleDecode} />

      <button
        type="button"
        data-testid="manual-entry"
        disabled={!activeProduct}
        onClick={() => activeProduct && setManualOpen(true)}
        className="rounded-xl bg-slate-800 py-2.5 text-sm font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700 disabled:opacity-40"
      >
        ✎ Enter manually (barcode won’t scan)
      </button>

      <Readout
        activeProductName={activeProduct?.product}
        productKg={productKg}
        productCount={productCount}
        poKg={totals.kg}
        poCount={totals.cartonCount}
        poProducts={totals.productCount}
        mixedUnits={totals.mixedUnits}
      />

      <div className="flex gap-2">
        {activeProduct && (
          <button
            type="button"
            data-testid="next-product"
            onClick={nextProduct}
            className="flex-1 rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-100 active:bg-slate-600"
          >
            ✓ Next product
          </button>
        )}
        <button
          type="button"
          data-testid="review"
          onClick={() => setView('summary')}
          className="flex-1 rounded-xl bg-sky-500 py-3 text-base font-bold text-slate-900 active:bg-sky-400"
        >
          Review / Finish ▸
        </button>
      </div>

      <DevPanel onSimulate={handleDecode} />

      {activeProduct ? (
        <CartonList cartons={activeProduct.cartons} onRemove={removeCarton} />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          {session.products.length === 0
            ? 'Scan the first carton to start the first product.'
            : 'Scan the first carton of the next product, or tap Review to finish.'}
        </div>
      )}

      {pending && (
        <ConfirmSheet
          pending={pending}
          supplier={session.supplier}
          brand={session.brand}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}

      {labelIssue && activeProduct && (
        <LabelChangeSheet
          parsed={labelIssue.parsed}
          activeProductName={activeProduct.product}
          activeGtin={activeProduct.gtin}
          onAddAnyway={labelAddAnyway}
          onCancel={labelCancel}
          onNextProduct={labelNextProduct}
        />
      )}

      {manualOpen && activeProduct && (
        <ManualEntrySheet
          productName={activeProduct.product}
          currentBatch={currentBatch}
          onSubmit={addManualCarton}
          onCancel={() => setManualOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsMenu
          scannedBy={scannedBy}
          poRef={session.poRef}
          onChangeName={(name) => {
            setScannedBy(name);
            showToast('Name updated', 'info');
          }}
          onEndSession={endSession}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
          <div
            className={`rounded-full px-4 py-2 text-sm font-medium shadow-lg ring-1 ${
              toast.kind === 'error'
                ? 'bg-rose-500/90 text-white ring-rose-300/40'
                : toast.kind === 'warn'
                  ? 'bg-amber-500/90 text-slate-900 ring-amber-300/40'
                  : 'bg-slate-100/95 text-slate-900 ring-slate-300/40'
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
