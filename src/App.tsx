import { useCallback, useEffect, useRef, useState } from 'react';
import type { CartonRecord, GtinProfile, Session } from './types';
import { parseGS1, type ParsedCarton } from './lib/gs1';
import { roundKg, toKg, type WeightUnit } from './lib/units';
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
import { OCR_MIN_CONFIDENCE, ocrToParsed, parseWeightText, type OcrRead } from './lib/ocr';
import { toCartonRecord, toManualCartonRecord, type ManualEntryInput } from './lib/carton';
import { exportSessionToXlsx } from './lib/export';
import { signalSuccess, signalError } from './lib/feedback';
import { useLocalStorage } from './hooks/useLocalStorage';

import { SetupScreen } from './components/SetupScreen';
import { SessionSetup } from './components/SessionSetup';
import { ScannerView, type ScanMode } from './components/ScannerView';
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
  parsed: ParsedCarton;
}

/** A captured weight awaiting human confirmation (failed a guardrail). */
interface WeightPending {
  warnings: string[];
  productName: string;
  /** Barcode capture (exactly one of parsed/ocr is set). */
  parsed?: ParsedCarton;
  /** OCR capture. */
  ocr?: { value: number; unit: WeightUnit; kg: number; text: string };
}

/** Ignore the identical decoded string if it repeats within this window. */
const REPEAT_WINDOW_MS = 3000;
/** After a successful OCR capture, ignore reads while the user moves cartons. */
const OCR_SUCCESS_COOLDOWN_MS = 2500;
/** Min gap between low-confidence error tones (avoid machine-gun beeping). */
const OCR_LOW_CONF_THROTTLE_MS = 2000;

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

export default function App() {
  const [scannedBy, setScannedBy] = useLocalStorage<string>(STORAGE_KEYS.scannedBy, '');
  const [session, setSession] = useLocalStorage<Session | null>(STORAGE_KEYS.session, null);
  const [profiles, setProfiles] = useState<Record<string, GtinProfile>>(() => loadProfiles());

  const [view, setView] = useState<'scan' | 'summary'>('scan');
  const [mode, setMode] = useState<ScanMode>('barcode');
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [labelIssue, setLabelIssue] = useState<LabelIssue | null>(null);
  const [weightPending, setWeightPending] = useState<WeightPending | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [ocrFeedback, setOcrFeedback] = useState('');

  const lastDecodeRef = useRef<{ raw: string; time: number }>({ raw: '', time: 0 });
  const ocrCooldownUntilRef = useRef(0);
  const lastLowConfToneRef = useRef(0);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!ocrFeedback) return;
    const t = setTimeout(() => setOcrFeedback(''), 4000);
    return () => clearTimeout(t);
  }, [ocrFeedback]);

  const showToast = useCallback((text: string, kind: ToastKind = 'info') => {
    setToast({ text, kind });
  }, []);

  // --- counting -----------------------------------------------------------

  /** Append a scanned carton to the active pallet (+ feedback). */
  const commitScanned = useCallback(
    (parsed: ParsedCarton) => {
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

  /** Append an OCR-read carton (inherits GTIN + batch from the product). */
  const commitOcr = useCallback(
    (ocr: { value: number; unit: WeightUnit; kg: number; text: string }) => {
      setSession((prev) => {
        if (!prev) return prev;
        const active = prev.products.find((p) => p.id === prev.activeProductId);
        if (!active) return prev;
        const batch = productCartons(active).at(-1)?.batch;
        const parsed = ocrToParsed(
          { value: ocr.value, unit: ocr.unit, text: ocr.text },
          { gtin: active.gtin || undefined, batch },
        );
        const record = toCartonRecord(parsed, {
          scannedBy,
          poRef: prev.poRef,
          supplier: prev.supplier,
          brand: prev.brand,
          product: active.product,
          entry: 'ocr',
        });
        return withCartonAppended(prev, record);
      });
      signalSuccess();
      const msg =
        ocr.unit === 'lb'
          ? `${ocr.value} lb → ${roundKg(ocr.kg).toFixed(2)} kg`
          : `${roundKg(ocr.kg).toFixed(2)} kg`;
      setOcrFeedback(`✓ ${msg}`);
      showToast(`Counted (OCR) · ${msg}`, 'info');
      ocrCooldownUntilRef.current = Date.now() + OCR_SUCCESS_COOLDOWN_MS;
    },
    [scannedBy, setSession, showToast],
  );

  /** Barcode weights get the range guardrail only (decimals are exactly encoded). */
  const scanWeightWarnings = useCallback(
    (parsed: ParsedCarton) => weightWarnings({ weightKg: parsed.weightKg ?? 0 }),
    [],
  );

  /** Single entry point for camera decodes and simulated barcode scans. */
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
        setPending({
          parsed,
          product: profile?.productName ?? '',
          isNewGtin: !profile,
          weightWarnings: warnings,
          entry: 'scan',
        });
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
    [session, pending, labelIssue, weightPending, manualOpen, view, profiles, scanWeightWarnings, commitScanned, showToast],
  );

  /**
   * Single entry point for OCR reads (camera loop + dev simulate). Auto-accepts
   * a read that passes every check; interrupts only when one fails.
   */
  const handleOcrRead = useCallback(
    ({ text, confidence }: OcrRead) => {
      if (!session || pending || labelIssue || weightPending || manualOpen || view === 'summary') return;
      if (Date.now() < ocrCooldownUntilRef.current) return;

      // Not weight-shaped at all -> keep silently scanning (like an undecoded frame).
      const w = parseWeightText(text);
      if (!w) return;

      // Check 1: OCR confidence. A shaky read never auto-counts.
      if (confidence < OCR_MIN_CONFIDENCE) {
        const now = Date.now();
        if (now - lastLowConfToneRef.current > OCR_LOW_CONF_THROTTLE_MS) {
          lastLowConfToneRef.current = now;
          signalError();
          setOcrFeedback('Low confidence — hold steady and re-point');
        }
        return;
      }

      const kg = toKg(w.value, w.unit);
      // Checks 2 + 3: range (after lb->kg) and expected decimal shape.
      const warnings = weightWarnings({ weightKg: kg, hasDecimal: w.hasDecimal, requireDecimal: true });
      const active = session.products.find((p) => p.id === session.activeProductId) ?? null;

      // First carton of a (new) product via OCR -> product confirm (safety rule
      // applies to every product regardless of capture mode).
      if (!active) {
        setPending({
          parsed: ocrToParsed({ value: w.value, unit: w.unit, text }),
          product: '',
          isNewGtin: false,
          weightWarnings: warnings,
          entry: 'ocr',
        });
        return;
      }

      if (warnings.length) {
        signalError();
        setWeightPending({
          ocr: { value: w.value, unit: w.unit, kg, text },
          warnings,
          productName: active.product,
        });
        return;
      }

      // All checks passed -> auto-capture. Beep, tally, next carton.
      commitOcr({ value: w.value, unit: w.unit, kg, text });
    },
    [session, pending, labelIssue, weightPending, manualOpen, view, commitOcr],
  );

  /** Confirm the first carton of a new product (creates product + pallet 1). */
  const confirmPending = useCallback(
    (productName: string) => {
      if (!pending) return;
      const { parsed, entry } = pending;
      const gtin = parsed.gtin ?? ''; // '' for OCR-started products (no barcode)
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
          entry,
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
      if (gtin) {
        setProfiles(
          upsertProfile({
            gtin,
            productName,
            supplierName: session?.supplier ?? '',
            fingerprint: parsed.fingerprint ?? '',
            updatedAt: new Date().toISOString(),
          }),
        );
      }
      signalSuccess();
      showToast(`Counted ${productName} · ${roundKg(parsed.weightKg ?? 0).toFixed(2)} kg`, 'info');
      if (entry === 'ocr') ocrCooldownUntilRef.current = Date.now() + OCR_SUCCESS_COOLDOWN_MS;
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
  }, [labelIssue, session, scanWeightWarnings, commitScanned]);

  const labelCancel = useCallback(() => setLabelIssue(null), []);

  const labelNextProduct = useCallback(() => {
    if (!labelIssue) return;
    const { parsed } = labelIssue;
    const gtin = parsed.gtin!;
    const profile = profiles[gtin];
    setSession((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
    setLabelIssue(null);
    setMode('barcode');
    setPending({
      parsed,
      product: profile?.productName ?? '',
      isNewGtin: !profile,
      weightWarnings: weightWarnings({ weightKg: parsed.weightKg ?? 0 }),
      entry: 'scan',
    });
  }, [labelIssue, profiles, setSession]);

  // --- weight confirmation (captured, non-first carton) --------------------

  const confirmWeight = useCallback(() => {
    if (!weightPending) return;
    if (weightPending.parsed) commitScanned(weightPending.parsed);
    else if (weightPending.ocr) commitOcr(weightPending.ocr);
    setWeightPending(null);
  }, [weightPending, commitScanned, commitOcr]);

  // --- pallet / product / session controls --------------------------------

  /** New pallet, same product: drop the active pallet so the next carton starts one. */
  const newPallet = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, activePalletId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
  }, [setSession]);

  const nextProduct = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
    setMode('barcode'); // OCR is opted into per product
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
      setMode('barcode');
    },
    [scannedBy, setSession],
  );

  const endSession = useCallback(() => {
    setSession(null);
    setSettingsOpen(false);
    setView('scan');
    setMode('barcode');
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
      setMode('barcode');
      setView('scan');
    },
    [setSession],
  );

  const amendPallet = useCallback(
    (productId: string, palletId: string) => {
      setSession((prev) => (prev ? { ...prev, activeProductId: productId, activePalletId: palletId } : prev));
      lastDecodeRef.current = { raw: '', time: 0 };
      setMode('barcode');
      setView('scan');
    },
    [setSession],
  );

  const captureNewProduct = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
    setMode('barcode');
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
        mode={mode}
        onDecode={handleDecode}
        onOcrRead={handleOcrRead}
        ocrFeedback={ocrFeedback}
      />

      {/* Capture mode: barcode is primary; OCR is opted into per product when
          the barcodes don't carry weight. */}
      <div className="flex overflow-hidden rounded-xl text-sm font-semibold ring-1 ring-slate-600">
        <button
          type="button"
          data-testid="mode-barcode"
          onClick={() => setMode('barcode')}
          className={`flex-1 py-2.5 ${
            mode === 'barcode' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'
          }`}
        >
          ▮▯ Barcode
        </button>
        <button
          type="button"
          data-testid="mode-ocr"
          onClick={() => setMode('ocr')}
          className={`flex-1 py-2.5 ${
            mode === 'ocr' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'
          }`}
        >
          🔤 OCR weight
        </button>
      </div>

      {mode === 'ocr' && ocrFeedback && (
        <div
          data-testid="ocr-feedback"
          className="rounded-lg bg-slate-800/70 px-3 py-1.5 text-center text-sm font-medium text-slate-200 ring-1 ring-slate-700"
        >
          {ocrFeedback}
        </div>
      )}

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

      <DevPanel onSimulate={handleDecode} onSimulateOcr={(text, confidence) => handleOcrRead({ text, confidence })} />

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
          weightKg={weightPending.parsed?.weightKg ?? weightPending.ocr?.kg ?? 0}
          netWeight={weightPending.parsed?.netWeight ?? weightPending.ocr?.value ?? 0}
          unit={weightPending.parsed?.weightUnit ?? weightPending.ocr?.unit ?? 'kg'}
          gtin={weightPending.parsed?.gtin}
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
