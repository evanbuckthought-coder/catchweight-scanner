import { useCallback, useEffect, useRef, useState } from 'react';
import type { CartonRecord, GtinProfile, Session } from './types';
import { parseGS1 } from './lib/gs1';
import { roundKg, toKg } from './lib/units';
import { STORAGE_KEYS, uid } from './lib/storage';
import { loadProfiles, upsertProfile } from './lib/profiles';
import {
  allCartons,
  findDuplicate,
  palletSubtotal,
  poTotals,
  productCartons,
  productSubtotal,
} from './lib/session';
import { weightWarnings } from './lib/guardrails';
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
import { WeightConfirmSheet } from './components/WeightConfirmSheet';
import { ManualEntrySheet } from './components/ManualEntrySheet';

type ToastKind = 'info' | 'warn' | 'error';
interface Toast {
  text: string;
  kind: ToastKind;
}

interface LabelIssue {
  parsed: ReturnType<typeof parseGS1>;
}
interface WeightPending {
  parsed: ReturnType<typeof parseGS1>;
  warnings: string[];
  productName: string;
}

const REPEAT_WINDOW_MS = 3000;

/** Append a carton to the active product's active pallet, lazily creating a new
 *  pallet when there isn't one (e.g. just after "New pallet"). Pure. */
function withCartonAppended(session: Session, record: CartonRecord): Session {
  const active = session.products.find((p) => p.id === session.activeProductId);
  if (!active) return session;
  const hasActivePallet = active.pallets.some((pl) => pl.id === session.activePalletId);
  const newPalletId = hasActivePallet ? null : uid();

  const products = session.products.map((p) => {
    if (p.id !== session.activeProductId) return p;
    if (newPalletId) {
      return {
        ...p,
        pallets: [...p.pallets, { id: newPalletId, startedAt: new Date().toISOString(), cartons: [record] }],
      };
    }
    return {
      ...p,
      pallets: p.pallets.map((pl) =>
        pl.id === session.activePalletId ? { ...pl, cartons: [...pl.cartons, record] } : pl,
      ),
    };
  });
  return { ...session, products, activePalletId: newPalletId ?? session.activePalletId };
}

/** Weight warnings for a scanned (OCR) carton. */
function scanWeightWarnings(parsed: ReturnType<typeof parseGS1>): string[] {
  return weightWarnings({
    weightKg: parsed.weightKg ?? 0,
    netWeight: parsed.netWeight ?? 0,
    isScan: true,
  });
}

export default function App() {
  const [scannedBy, setScannedBy] = useLocalStorage<string>(STORAGE_KEYS.scannedBy, '');
  const [session, setSession] = useLocalStorage<Session | null>(STORAGE_KEYS.session, null);
  const [profiles, setProfiles] = useState<Record<string, GtinProfile>>(() => loadProfiles());

  const [view, setView] = useState<'scan' | 'summary'>('scan');
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [labelIssue, setLabelIssue] = useState<LabelIssue | null>(null);
  const [weightPending, setWeightPending] = useState<WeightPending | null>(null);
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

  /** Append a scanned carton to the active pallet (+ feedback). */
  const commitScanned = useCallback(
    (parsed: ReturnType<typeof parseGS1>) => {
      setSession((prev) => {
        if (!prev) return prev;
        const active = prev.products.find((p) => p.id === prev.activeProductId);
        if (!active) return prev;
        const record = toCartonRecord(parsed, {
          scannedBy,
          poRef: prev.poRef,
          supplier: prev.supplier,
          brand: prev.brand,
          product: active.product,
        });
        return withCartonAppended(prev, record);
      });
      signalSuccess();
      showToast(`Counted · ${roundKg(parsed.weightKg ?? 0).toFixed(2)} kg`, 'info');
    },
    [scannedBy, setSession, showToast],
  );

  const handleDecode = useCallback(
    (raw: string) => {
      if (!session || pending || labelIssue || weightPending || manualOpen || view === 'summary') return;

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
      const warnings = scanWeightWarnings(parsed);

      // First carton of a (new) product -> product confirm (weight warnings shown there too).
      if (!active) {
        const profile = profiles[gtin];
        setPending({ parsed, product: profile?.productName ?? '', isNewGtin: !profile, weightWarnings: warnings });
        return;
      }

      // Label differs from the current product -> warn.
      if (parsed.gtin !== active.gtin || parsed.fingerprint !== active.fingerprint) {
        setLabelIssue({ parsed });
        return;
      }

      // Same product. Weight guardrail before committing.
      if (warnings.length) {
        setWeightPending({ parsed, warnings, productName: active.product });
        return;
      }
      commitScanned(parsed);
    },
    [session, pending, labelIssue, weightPending, manualOpen, view, profiles, commitScanned, showToast],
  );

  /** Confirm the first carton of a new product (creates product + pallet 1). */
  const confirmPending = useCallback(
    (productName: string) => {
      if (!pending) return;
      const { parsed } = pending;
      const gtin = parsed.gtin!;
      const productId = uid();
      const palletId = uid();
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
              id: productId,
              product: productName,
              gtin,
              fingerprint: parsed.fingerprint ?? '',
              startedAt: new Date().toISOString(),
              pallets: [{ id: palletId, startedAt: new Date().toISOString(), cartons: [record] }],
            },
          ],
          activeProductId: productId,
          activePalletId: palletId,
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
    const { parsed } = labelIssue;
    const active = session.products.find((p) => p.id === session.activeProductId);
    setLabelIssue(null);
    if (!active) return;
    const warnings = scanWeightWarnings(parsed);
    if (warnings.length) {
      setWeightPending({ parsed, warnings, productName: active.product });
      return;
    }
    commitScanned(parsed);
  }, [labelIssue, session, commitScanned]);

  const labelCancel = useCallback(() => setLabelIssue(null), []);

  const labelNextProduct = useCallback(() => {
    if (!labelIssue) return;
    const { parsed } = labelIssue;
    const gtin = parsed.gtin!;
    const profile = profiles[gtin];
    setSession((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
    setLabelIssue(null);
    setPending({ parsed, product: profile?.productName ?? '', isNewGtin: !profile, weightWarnings: scanWeightWarnings(parsed) });
  }, [labelIssue, profiles, setSession]);

  // --- weight confirmation (scanned, non-first carton) --------------------

  const confirmWeight = useCallback(() => {
    if (!weightPending) return;
    commitScanned(weightPending.parsed);
    setWeightPending(null);
  }, [weightPending, commitScanned]);

  // --- pallet / product / session controls --------------------------------

  /** New pallet, same product: drop the active pallet so the next carton starts one. */
  const newPallet = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, activePalletId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
  }, [setSession]);

  const nextProduct = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
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
        return withCartonAppended(prev, record);
      });
      signalSuccess();
      showToast(`Added ${roundKg(toKg(input.netWeight, input.unit)).toFixed(2)} kg (manual)`, 'info');
      setManualOpen(false);
    },
    [scannedBy, setSession, showToast],
  );

  /** Remove a carton; prune empty pallets and products; fix active pointers. */
  const removeCarton = useCallback(
    (cartonId: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const products = prev.products
          .map((p) => ({
            ...p,
            pallets: p.pallets
              .map((pl) => ({ ...pl, cartons: pl.cartons.filter((c) => c.id !== cartonId) }))
              .filter((pl) => pl.cartons.length > 0),
          }))
          .filter((p) => p.pallets.length > 0);
        const productOk = products.some((p) => p.id === prev.activeProductId);
        const palletOk = products.some((p) => p.pallets.some((pl) => pl.id === prev.activePalletId));
        return {
          ...prev,
          products,
          activeProductId: productOk ? prev.activeProductId : null,
          activePalletId: palletOk ? prev.activePalletId : null,
        };
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
        activePalletId: null,
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
      setSession((prev) => {
        if (!prev) return prev;
        const product = prev.products.find((p) => p.id === productId);
        return { ...prev, activeProductId: productId, activePalletId: product?.pallets.at(-1)?.id ?? null };
      });
      lastDecodeRef.current = { raw: '', time: 0 };
      setView('scan');
    },
    [setSession],
  );

  const amendPallet = useCallback(
    (productId: string, palletId: string) => {
      setSession((prev) => (prev ? { ...prev, activeProductId: productId, activePalletId: palletId } : prev));
      lastDecodeRef.current = { raw: '', time: 0 };
      setView('scan');
    },
    [setSession],
  );

  const captureNewProduct = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
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
    return <SessionSetup scannedBy={scannedBy} onStart={startSession} onEditName={() => setEditingName(true)} />;
  }

  if (view === 'summary') {
    return (
      <SummaryScreen
        session={session}
        onAmendProduct={amendProduct}
        onAmendPallet={amendPallet}
        onCaptureNewProduct={captureNewProduct}
        onBackToScan={() => setView('scan')}
        onExport={handleExport}
        onEndSession={endSession}
      />
    );
  }

  const activeProduct = session.products.find((p) => p.id === session.activeProductId) ?? null;
  const activePallet = activeProduct?.pallets.find((pl) => pl.id === session.activePalletId) ?? null;
  const totals = poTotals(session);
  const prodSub = activeProduct ? productSubtotal(activeProduct) : { count: 0, kg: 0 };
  const palSub = activePallet ? palletSubtotal(activePallet) : { count: 0, kg: 0 };
  const palletNumber = activeProduct
    ? activePallet
      ? activeProduct.pallets.findIndex((pl) => pl.id === activePallet.id) + 1
      : activeProduct.pallets.length + 1
    : 1;
  const lastBatch = activeProduct ? productCartons(activeProduct).at(-1)?.batch : undefined;
  const canNewPallet = !!activeProduct && !!activePallet && activePallet.cartons.length > 0;

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

      <ScannerView
        active
        paused={!!pending || !!labelIssue || !!weightPending || manualOpen}
        onDecode={handleDecode}
      />

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
        palletNumber={palletNumber}
        palletNew={!!activeProduct && !activePallet}
        palletKg={palSub.kg}
        palletCount={palSub.count}
        productKg={prodSub.kg}
        productCount={prodSub.count}
        poKg={totals.kg}
        poCount={totals.cartonCount}
        poProducts={totals.productCount}
        poPallets={totals.palletCount}
        mixedUnits={totals.mixedUnits}
      />

      {canNewPallet && (
        <button
          type="button"
          data-testid="new-pallet"
          onClick={newPallet}
          className="rounded-xl bg-indigo-500/80 py-3 text-base font-semibold text-white active:bg-indigo-500"
        >
          + New pallet – same product
        </button>
      )}

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

      {activePallet ? (
        <CartonList cartons={activePallet.cartons} onRemove={removeCarton} />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          {!activeProduct
            ? session.products.length === 0
              ? 'Scan the first carton to start the first product.'
              : 'Scan the first carton of the next product, or tap Review to finish.'
            : `Scan the first carton of Pallet ${palletNumber}.`}
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

      {weightPending && (
        <WeightConfirmSheet
          parsed={weightPending.parsed}
          warnings={weightPending.warnings}
          productName={weightPending.productName}
          onConfirm={confirmWeight}
          onCancel={() => setWeightPending(null)}
        />
      )}

      {manualOpen && activeProduct && (
        <ManualEntrySheet
          productName={activeProduct.product}
          currentBatch={lastBatch}
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
