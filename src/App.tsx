import { useCallback, useEffect, useRef, useState } from 'react';
import type { CartonRecord, GtinProfile, Session } from './types';
import { parseGS1, type ParsedCarton } from './lib/gs1';
import { rememberSupplier } from './lib/suppliers';
import { roundKg, toKg, type WeightUnit } from './lib/units';
import { STORAGE_KEYS, uid } from './lib/storage';
import { loadProfiles, removeProfile, upsertProfile } from './lib/profiles';
import {
  allCartons,
  findDuplicate,
  nextPalletNumber,
  palletSubtotal,
  poTotals,
  productCartons,
  productSubtotal,
} from './lib/session';
import { loadActiveSession, saveActiveSession, saveReceival } from './lib/persistence';
import { weightWarnings } from './lib/guardrails';
import { warmOcrCache } from './lib/ocr';
import { toCartonRecord, toManualCartonRecord, type ManualEntryInput } from './lib/carton';
import { exportSessionToXlsx } from './lib/export';
import { signalSuccess, signalError } from './lib/feedback';
import { useLocalStorage } from './hooks/useLocalStorage';

import { SetupScreen } from './components/SetupScreen';
import { HomeScreen } from './components/HomeScreen';
import { SessionSetup } from './components/SessionSetup';
import { ScannerView } from './components/ScannerView';
import { Readout } from './components/Readout';
import { CartonList } from './components/CartonList';
import { DevPanel } from './components/DevPanel';
import { SettingsMenu } from './components/SettingsMenu';
import { SettingsScreen } from './components/SettingsScreen';
import { LabelIntelligenceScreen } from './components/LabelIntelligenceScreen';
import { SummaryScreen } from './components/SummaryScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { ResumePrompt } from './components/ResumePrompt';
import { ConfirmSheet, type PendingConfirm } from './components/ConfirmSheet';
import { LabelChangeSheet } from './components/LabelChangeSheet';
import { WeightConfirmSheet } from './components/WeightConfirmSheet';
import { ManualKeypad } from './components/ManualKeypad';

type ToastKind = 'info' | 'warn' | 'error';
interface Toast {
  text: string;
  kind: ToastKind;
}

interface LabelIssue {
  parsed: ParsedCarton;
}

/** A barcode-captured weight awaiting human confirmation (failed a guardrail). */
interface WeightPending {
  warnings: string[];
  productName: string;
  parsed: ParsedCarton;
}

/** Ignore the identical decoded string while it stays in view (sliding window). */
const REPEAT_WINDOW_MS = 3000;

/** Append a carton to the active product's active pallet, lazily creating a new
 *  pallet (with the next fixed number) when there isn't one. Pure. */
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
        pallets: [
          ...p.pallets,
          { id: newPalletId, number: nextPalletNumber(p), startedAt: new Date().toISOString(), cartons: [record] },
        ],
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
  // Test tools default ON in dev builds, OFF in production (toggle in Settings).
  const [devTools, setDevTools] = useLocalStorage<boolean>(STORAGE_KEYS.devTools, import.meta.env.DEV);
  const [profiles, setProfiles] = useState<Record<string, GtinProfile>>(() => loadProfiles());

  // --- session persistence (IndexedDB) -------------------------------------
  const [session, setSessionState] = useState<Session | null>(null);
  const [boot, setBoot] = useState<'loading' | 'ready'>('loading');
  const [persistError, setPersistError] = useState(false);
  /** Latest session for synchronous checks inside commit paths. */
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    let alive = true;
    loadActiveSession()
      .then((s) => {
        if (!alive) return;
        // An unfinished session isn't auto-resumed: it surfaces as the
        // "Resume last session" item on the home screen.
        if (s) setSessionState(s);
        setBoot('ready');
      })
      .catch((err) => {
        console.warn('Failed to load session from device storage:', err);
        if (alive) {
          setBoot('ready');
          setPersistError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Warm the OCR engine cache in the background while connectivity is likely.
  // Each deploy renames the lazy tesseract chunk, so without this the first
  // OCR use after an app update needs reception — which coolstores don't have.
  // Delayed so it never competes with boot/camera startup; failures are
  // swallowed inside warmOcrCache (offline open = try again next open).
  useEffect(() => {
    const t = window.setTimeout(() => void warmOcrCache(), 3000);
    return () => window.clearTimeout(t);
  }, []);

  // Persist the in-progress session on every change; surface failures loudly —
  // silently accumulating cartons that a refresh would lose is not acceptable.
  useEffect(() => {
    if (boot === 'loading') return;
    saveActiveSession(session)
      .then(() => setPersistError(false))
      .catch((err) => {
        console.warn('Failed to persist session:', err);
        setPersistError(true);
      });
  }, [session, boot]);

  // --- UI state -------------------------------------------------------------
  /** Top-level navigation. Home is the entry point; 'capture' is the sacred
   *  receiving flow; 'resume-guard' protects an unfinished session when the
   *  user taps New receival while one exists. */
  const [nav, setNav] = useState<
    'home' | 'resume-guard' | 'session-setup' | 'capture' | 'history' | 'labels' | 'settings'
  >('home');
  const [view, setView] = useState<'scan' | 'summary'>('scan');
  /** Capture mode: barcode camera, or the manual-entry keypad (primary modes).
   *  OCR lives in Label Intelligence as an experimental trial, off this path. */
  const [mode, setMode] = useState<'barcode' | 'manual'>('barcode');
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [labelIssue, setLabelIssue] = useState<LabelIssue | null>(null);
  const [weightPending, setWeightPending] = useState<WeightPending | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  /** Manual-keypad unit — kg default, persisted so lb suppliers set it once. */
  const [manualUnit, setManualUnit] = useLocalStorage<WeightUnit>(STORAGE_KEYS.manualUnit, 'kg');

  const lastDecodeRef = useRef<{ raw: string; time: number }>({ raw: '', time: 0 });
  /**
   * True while any capture-interrupting sheet is open. Set synchronously when a
   * sheet opens so two decodes in the SAME camera frame can't both act (React
   * state alone is stale within a single synchronous batch).
   */
  const sheetGateRef = useRef(false);
  useEffect(() => {
    sheetGateRef.current = !!(pending || labelIssue || weightPending);
  }, [pending, labelIssue, weightPending]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((text: string, kind: ToastKind = 'info') => {
    setToast({ text, kind });
  }, []);

  // --- counting -------------------------------------------------------------

  /** Append a scanned carton to the active pallet. Feedback only fires when the
   *  carton can actually be counted — never a success beep for a no-op. */
  const commitScanned = useCallback(
    (parsed: ParsedCarton) => {
      const cur = sessionRef.current;
      const active = cur?.products.find((p) => p.id === cur.activeProductId);
      if (!cur || !active) {
        signalError();
        showToast('No active product — carton NOT counted', 'error');
        return;
      }
      setSessionState((prev) => {
        if (!prev) return prev;
        const activeNow = prev.products.find((p) => p.id === prev.activeProductId);
        if (!activeNow) return prev;
        const record = toCartonRecord(parsed, {
          scannedBy,
          poRef: prev.poRef,
          supplier: prev.supplier,
          brand: prev.brand,
          product: activeNow.product,
        });
        return withCartonAppended(prev, record);
      });
      signalSuccess();
      showToast(`Counted · ${roundKg(parsed.weightKg ?? 0).toFixed(2)} kg`, 'info');
    },
    [scannedBy, showToast],
  );

  /** Barcode weights get the range guardrail only (decimals are exactly encoded). */
  const scanWeightWarnings = useCallback(
    (parsed: ParsedCarton) => weightWarnings({ weightKg: parsed.weightKg ?? 0 }),
    [],
  );

  /** Single entry point for camera decodes and simulated barcode scans. */
  const handleDecode = useCallback(
    (raw: string) => {
      if (!session || boot !== 'ready' || sheetGateRef.current || view === 'summary') return;

      // Sliding repeat window: while the same label stays in view, keep
      // refreshing the timestamp so it can never re-add itself every 3s.
      const now = Date.now();
      if (raw === lastDecodeRef.current.raw && now - lastDecodeRef.current.time < REPEAT_WINDOW_MS) {
        lastDecodeRef.current.time = now;
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

      // Dedupe: hard on serials; identical-raw only for batch-only labels
      // (batches are shared across cartons and must not block the 2nd..Nth).
      const dup = findDuplicate(allCartons(session), { gtin, serial: parsed.serial, raw });
      if (dup) {
        signalError();
        showToast(
          parsed.serial
            ? `Already scanned · serial ${parsed.serial}`
            : 'Identical label already scanned (same batch + weight)',
          'warn',
        );
        return;
      }

      const active = session.products.find((p) => p.id === session.activeProductId) ?? null;
      const warnings = scanWeightWarnings(parsed);

      // First carton of a product -> product confirm. If this GTIN already
      // exists in the PO, confirming continues that product (new pallet)
      // instead of creating a duplicate group.
      if (!active) {
        const existing = session.products.find((p) => p.gtin === gtin);
        const profile = profiles[gtin];
        sheetGateRef.current = true;
        setPending({
          parsed,
          product: existing?.product ?? profile?.productName ?? '',
          isNewGtin: !profile,
          weightWarnings: warnings,
          entry: 'scan',
          resumeProductId: existing?.id,
        });
        return;
      }

      // Label differs from the current product -> warn.
      if (parsed.gtin !== active.gtin || parsed.fingerprint !== active.fingerprint) {
        sheetGateRef.current = true;
        setLabelIssue({ parsed });
        return;
      }

      // Same product. Weight guardrail before committing.
      if (warnings.length) {
        sheetGateRef.current = true;
        setWeightPending({ parsed, warnings, productName: active.product });
        return;
      }
      commitScanned(parsed);
    },
    [session, boot, view, profiles, scanWeightWarnings, commitScanned, showToast],
  );

  /** Confirm the first carton of a product: create it (pallet 1), or continue
   *  an existing product with the same GTIN on a new pallet. */
  const confirmPending = useCallback(
    (productName: string) => {
      if (!pending) return;
      const { parsed, entry, resumeProductId } = pending;
      const gtin = parsed.gtin ?? ''; // '' for OCR-started products (no barcode)
      setSessionState((prev) => {
        if (!prev) return prev;
        const record = toCartonRecord(parsed, {
          scannedBy,
          poRef: prev.poRef,
          supplier: prev.supplier,
          brand: prev.brand,
          product: productName,
          entry,
        });

        const existing = resumeProductId ? prev.products.find((p) => p.id === resumeProductId) : undefined;
        if (existing) {
          const palletId = uid();
          return {
            ...prev,
            products: prev.products.map((p) =>
              p.id === existing.id
                ? {
                    ...p,
                    product: productName,
                    pallets: [
                      ...p.pallets,
                      { id: palletId, number: nextPalletNumber(p), startedAt: new Date().toISOString(), cartons: [record] },
                    ],
                  }
                : p,
            ),
            activeProductId: existing.id,
            activePalletId: palletId,
          };
        }

        const productId = uid();
        const palletId = uid();
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
              pallets: [{ id: palletId, number: 1, startedAt: new Date().toISOString(), cartons: [record] }],
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
            supplierName: sessionRef.current?.supplier ?? '',
            fingerprint: parsed.fingerprint ?? '',
            updatedAt: new Date().toISOString(),
          }),
        );
      }
      signalSuccess();
      showToast(`Counted ${productName} · ${roundKg(parsed.weightKg ?? 0).toFixed(2)} kg`, 'info');
      setPending(null);
    },
    [pending, scannedBy, showToast],
  );

  // --- label-change resolutions ---------------------------------------------

  const labelAddAnyway = useCallback(() => {
    if (!labelIssue || !session) return;
    const { parsed } = labelIssue;
    const active = session.products.find((p) => p.id === session.activeProductId);
    setLabelIssue(null);
    if (!active) return;
    const warnings = scanWeightWarnings(parsed);
    if (warnings.length) {
      sheetGateRef.current = true;
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
    const existing = sessionRef.current?.products.find((p) => p.gtin === gtin);
    setSessionState((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
    setLabelIssue(null);
    setMode('barcode');
    sheetGateRef.current = true;
    setPending({
      parsed,
      product: existing?.product ?? profile?.productName ?? '',
      isNewGtin: !profile,
      weightWarnings: weightWarnings({ weightKg: parsed.weightKg ?? 0 }),
      entry: 'scan',
      resumeProductId: existing?.id,
    });
  }, [labelIssue, profiles]);

  // --- weight confirmation (captured, non-first carton) -----------------------

  const confirmWeight = useCallback(() => {
    if (!weightPending) return;
    commitScanned(weightPending.parsed);
    setWeightPending(null);
  }, [weightPending, commitScanned]);

  // --- pallet / product / session controls ------------------------------------

  const newPallet = useCallback(() => {
    setSessionState((prev) => (prev ? { ...prev, activePalletId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
  }, []);

  const nextProduct = useCallback(() => {
    setSessionState((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
    setMode('barcode'); // next product starts with its first-carton scan
  }, []);

  const addManualCarton = useCallback(
    (input: ManualEntryInput) => {
      const cur = sessionRef.current;
      const active = cur?.products.find((p) => p.id === cur.activeProductId);
      if (!cur || !active) {
        signalError();
        showToast('No active product — carton NOT counted', 'error');
        return;
      }
      setSessionState((prev) => {
        if (!prev) return prev;
        const activeNow = prev.products.find((p) => p.id === prev.activeProductId);
        if (!activeNow) return prev;
        const record = toManualCartonRecord(input, {
          scannedBy,
          poRef: prev.poRef,
          supplier: prev.supplier,
          brand: prev.brand,
          product: activeNow.product,
          gtin: activeNow.gtin,
        });
        return withCartonAppended(prev, record);
      });
      signalSuccess();
      showToast(`Added ${roundKg(toKg(input.netWeight, input.unit)).toFixed(2)} kg (manual)`, 'info');
    },
    [scannedBy, showToast],
  );

  /** Remove a carton; prune empty pallets and products; fix active pointers.
   *  Pallet numbers are fixed at creation, so no renumbering happens here. */
  const removeCarton = useCallback((cartonId: string) => {
    setSessionState((prev) => {
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
  }, []);

  const startSession = useCallback(
    (poRef: string, supplier: string, brand: string | undefined) => {
      // A free-typed supplier joins the type-ahead list for next time.
      rememberSupplier(supplier);
      setSessionState({
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
      setNav('capture');
    },
    [scannedBy],
  );

  /** Finish the receival: save to history, then clear the active session.
   *  On save failure the session is KEPT — nothing is lost. */
  const finishSession = useCallback(async () => {
    const cur = sessionRef.current;
    if (!cur || allCartons(cur).length === 0) return;
    try {
      await saveReceival(cur);
      setSessionState(null);
      setSettingsOpen(false);
      setView('scan');
      setMode('barcode');
      setNav('home');
      lastDecodeRef.current = { raw: '', time: 0 };
      showToast(`Saved ${cur.poRef} to history`, 'info');
    } catch (err) {
      showToast(`Save failed — session kept. ${String(err)}`, 'error');
    }
  }, [showToast]);

  /** Discard the session without saving (user-confirmed in the UI). */
  const discardSession = useCallback(() => {
    setSessionState(null);
    setSettingsOpen(false);
    setView('scan');
    setMode('barcode');
    setNav('home');
    lastDecodeRef.current = { raw: '', time: 0 };
  }, []);

  /** Delete a GTIN profile (Label Intelligence "delete / relearn"). App owns
   *  the profiles state so capture prefills can never go stale. */
  const deleteGtinProfile = useCallback((gtin: string) => {
    setProfiles(removeProfile(gtin));
  }, []);

  /** Create/update a GTIN profile from "Teach a new label". */
  const upsertGtinProfile = useCallback((profile: GtinProfile) => {
    setProfiles(upsertProfile(profile));
  }, []);

  const handleExport = useCallback(async () => {
    const cur = sessionRef.current;
    if (!cur || allCartons(cur).length === 0) {
      showToast('Nothing to export yet', 'warn');
      return;
    }
    try {
      const filename = await exportSessionToXlsx(cur);
      showToast(`Exported ${filename}`, 'info');
    } catch (err) {
      showToast(`Export failed: ${String(err)}`, 'error');
    }
  }, [showToast]);

  const amendProduct = useCallback((productId: string) => {
    setSessionState((prev) => {
      if (!prev) return prev;
      const product = prev.products.find((p) => p.id === productId);
      return { ...prev, activeProductId: productId, activePalletId: product?.pallets.at(-1)?.id ?? null };
    });
    lastDecodeRef.current = { raw: '', time: 0 };
    setMode('barcode');
    setView('scan');
  }, []);

  const amendPallet = useCallback((productId: string, palletId: string) => {
    setSessionState((prev) => (prev ? { ...prev, activeProductId: productId, activePalletId: palletId } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
    setMode('barcode');
    setView('scan');
  }, []);

  const captureNewProduct = useCallback(() => {
    setSessionState((prev) => (prev ? { ...prev, activeProductId: null, activePalletId: null } : prev));
    lastDecodeRef.current = { raw: '', time: 0 };
    setMode('barcode');
    setView('scan');
  }, []);

  // --- screens ---------------------------------------------------------------

  const persistBanner = persistError ? (
    <div className="fixed inset-x-0 top-0 z-[70] bg-rose-600 px-4 py-2 text-center text-sm font-bold text-white">
      ⚠ NOT SAVING to device storage — keep the app open and export your data now.
    </div>
  ) : null;

  if (boot === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

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

  if (nav === 'history') {
    return <HistoryScreen onBack={() => setNav('home')} />;
  }

  if (nav === 'labels') {
    return (
      <LabelIntelligenceScreen
        profiles={profiles}
        onDeleteProfile={deleteGtinProfile}
        onUpsertProfile={upsertGtinProfile}
        onBack={() => setNav('home')}
      />
    );
  }

  if (nav === 'settings') {
    return (
      <SettingsScreen
        scannedBy={scannedBy}
        onChangeName={(name) => {
          setScannedBy(name);
          setSessionState((prev) => (prev ? { ...prev, scannedBy: name } : prev));
        }}
        devTools={devTools}
        onToggleDevTools={setDevTools}
        onBack={() => setNav('home')}
      />
    );
  }

  // New receival tapped while an unfinished session exists: never silently
  // clobber it — the operator explicitly resumes or discards first.
  if (nav === 'resume-guard' && session) {
    return (
      <>
        {persistBanner}
        <ResumePrompt
          session={session}
          onResume={() => {
            setView('scan');
            setNav('capture');
          }}
          onDiscard={() => {
            discardSession();
            setNav('session-setup');
          }}
        />
      </>
    );
  }

  if (nav === 'session-setup') {
    return (
      <>
        {persistBanner}
        <SessionSetup
          scannedBy={scannedBy}
          onStart={startSession}
          onEditName={() => setEditingName(true)}
          onBack={() => setNav('home')}
        />
      </>
    );
  }

  // Home is the entry point and the fallback whenever capture has no session.
  if (nav !== 'capture' || !session) {
    return (
      <>
        {persistBanner}
        <HomeScreen
          activeSession={session}
          onNewReceival={() => setNav(session ? 'resume-guard' : 'session-setup')}
          onResume={() => {
            setView('scan');
            setNav('capture');
          }}
          onHistory={() => setNav('history')}
          onLabels={() => setNav('labels')}
          onSettings={() => setNav('settings')}
        />
      </>
    );
  }

  if (view === 'summary') {
    return (
      <>
        {persistBanner}
        <SummaryScreen
          session={session}
          onAmendProduct={amendProduct}
          onAmendPallet={amendPallet}
          onCaptureNewProduct={captureNewProduct}
          onBackToScan={() => setView('scan')}
          onExport={handleExport}
          onFinish={finishSession}
          onDiscard={discardSession}
        />
      </>
    );
  }

  const activeProduct = session.products.find((p) => p.id === session.activeProductId) ?? null;
  const activePallet = activeProduct?.pallets.find((pl) => pl.id === session.activePalletId) ?? null;
  const totals = poTotals(session);
  const prodSub = activeProduct ? productSubtotal(activeProduct) : { count: 0, kg: 0 };
  const palSub = activePallet ? palletSubtotal(activePallet) : { count: 0, kg: 0 };
  const palletNumber = activePallet
    ? activePallet.number
    : activeProduct
      ? nextPalletNumber(activeProduct)
      : 1;
  const lastBatch = activeProduct ? productCartons(activeProduct).at(-1)?.batch : undefined;
  const canNewPallet = !!activeProduct && !!activePallet && activePallet.cartons.length > 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-3">
      {persistBanner}
      <header className="flex items-center justify-between gap-2">
        {/* Navigation chrome only: leaves capture WITHOUT ending the session
            (it persists and reappears as "Resume last session" on home). */}
        <button
          type="button"
          data-testid="capture-home"
          onClick={() => setNav('home')}
          aria-label="Home"
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-slate-300 ring-1 ring-slate-600"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
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
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-slate-300 ring-1 ring-slate-600"
        >
          ⚙
        </button>
      </header>

      {mode === 'barcode' ? (
        <ScannerView
          active
          paused={!!pending || !!labelIssue || !!weightPending}
          mode="barcode"
          onDecode={handleDecode}
          onOcrRead={() => {}}
        />
      ) : (
        <ManualKeypad
          productName={activeProduct?.product ?? null}
          lastBatch={lastBatch}
          unit={manualUnit}
          onUnitChange={setManualUnit}
          onCommit={(netWeight, unit) => addManualCarton({ netWeight, unit, batch: lastBatch })}
        />
      )}

      {/* Capture modes: barcode camera, or the manual keypad (damaged/unreadable
          barcodes). OCR lives in Label Intelligence as an experimental trial. */}
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
          data-testid="mode-manual"
          onClick={() => setMode('manual')}
          className={`flex-1 py-2.5 ${
            mode === 'manual' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-300'
          }`}
        >
          ✎ Manual entry
        </button>
      </div>

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

      {devTools && (
        <DevPanel onSimulate={handleDecode} />
      )}

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
          weightKg={weightPending.parsed.weightKg ?? 0}
          netWeight={weightPending.parsed.netWeight ?? 0}
          unit={weightPending.parsed.weightUnit ?? 'kg'}
          gtin={weightPending.parsed.gtin}
          warnings={weightPending.warnings}
          productName={weightPending.productName}
          onConfirm={confirmWeight}
          onCancel={() => setWeightPending(null)}
        />
      )}

      {settingsOpen && (
        <SettingsMenu
          scannedBy={scannedBy}
          poRef={session.poRef}
          onChangeName={(name) => {
            setScannedBy(name);
            // Keep the session-level name in sync (it feeds the export summary).
            setSessionState((prev) => (prev ? { ...prev, scannedBy: name } : prev));
            showToast('Name updated', 'info');
          }}
          onEndSession={discardSession}
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
