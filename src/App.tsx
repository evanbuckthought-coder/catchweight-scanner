import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GtinProfile, ReceiptExpectation, Session } from './types';
import { parseGS1 } from './lib/gs1';
import { suggestSupplier } from './lib/suppliers';
import { roundKg } from './lib/units';
import { STORAGE_KEYS, uid } from './lib/storage';
import { loadProfiles, upsertProfile } from './lib/profiles';
import { computeVariance, findDuplicate } from './lib/session';
import { toCartonRecord } from './lib/carton';
import { exportSessionToXlsx } from './lib/export';
import { useLocalStorage } from './hooks/useLocalStorage';

import { SetupScreen } from './components/SetupScreen';
import { SessionSetup } from './components/SessionSetup';
import { ScannerView } from './components/ScannerView';
import { Readout } from './components/Readout';
import { VarianceBar } from './components/VarianceBar';
import { CartonList } from './components/CartonList';
import { DevPanel } from './components/DevPanel';
import { SettingsMenu } from './components/SettingsMenu';
import { ConfirmSheet, type PendingConfirm, type ConfirmReason } from './components/ConfirmSheet';

type ToastKind = 'info' | 'warn' | 'error';
interface Toast {
  text: string;
  kind: ToastKind;
}

/** Ignore the identical decoded string if it repeats within this window. */
const REPEAT_WINDOW_MS = 3000;

export default function App() {
  const [scannedBy, setScannedBy] = useLocalStorage<string>(STORAGE_KEYS.scannedBy, '');
  const [session, setSession] = useLocalStorage<Session | null>(STORAGE_KEYS.session, null);
  const [profiles, setProfiles] = useState<Record<string, GtinProfile>>(() => loadProfiles());

  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const lastDecodeRef = useRef<{ raw: string; time: number }>({ raw: '', time: 0 });

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((text: string, kind: ToastKind = 'info') => {
    setToast({ text, kind });
  }, []);

  const variance = useMemo(
    () => (session ? computeVariance(session) : null),
    [session],
  );

  // --- counting -----------------------------------------------------------

  const addCarton = useCallback(
    (parsed: ReturnType<typeof parseGS1>, product: string, supplier: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const record = toCartonRecord(parsed, {
          scannedBy,
          receiptRef: prev.receiptRef,
          product,
          supplier,
        });
        return { ...prev, cartons: [...prev.cartons, record] };
      });
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(60);
      showToast(`Counted ${product || 'carton'} · ${roundKg(parsed.weightKg ?? 0).toFixed(2)} kg`, 'info');
    },
    [scannedBy, setSession, showToast],
  );

  /** Single entry point for both camera decodes and simulated/manual scans. */
  const handleDecode = useCallback(
    (raw: string) => {
      if (!session || pending) return; // not counting, or waiting on a confirm

      // Debounce identical repeats (camera fires many frames per second).
      const now = Date.now();
      if (raw === lastDecodeRef.current.raw && now - lastDecodeRef.current.time < REPEAT_WINDOW_MS) {
        return;
      }
      lastDecodeRef.current = { raw, time: now };

      const parsed = parseGS1(raw);
      if (!parsed.valid) {
        showToast(parsed.errors[0] ?? 'Could not parse label', 'error');
        return;
      }
      const gtin = parsed.gtin!;

      // Exact re-scan dedupe (same GTIN + trace id within the session).
      if (findDuplicate(session.cartons, gtin, parsed.traceId)) {
        showToast(`Already scanned · ${parsed.traceAI === '10' ? 'batch' : 'serial'} ${parsed.traceId}`, 'warn');
        return;
      }

      const profile = profiles[gtin];
      const isFirstOfSession = session.cartons.length === 0;
      const isNewGtin = !profile;
      const fingerprintChanged = !!profile && profile.fingerprint !== parsed.fingerprint;
      const suggested = suggestSupplier(gtin);

      // Confirm needed when: first carton of the session (safety rule — always),
      // a never-seen GTIN, or a known GTIN whose label format changed.
      if (isFirstOfSession || isNewGtin || fingerprintChanged) {
        const reason: ConfirmReason = isNewGtin
          ? 'new-gtin'
          : fingerprintChanged
            ? 'fingerprint-changed'
            : 'first-of-session';
        setPending({
          parsed,
          product: profile?.productName ?? '',
          supplier: profile?.supplierName ?? suggested ?? '',
          suggestedSupplier: suggested,
          reason,
        });
        return;
      }

      // Known GTIN, not the first carton — straight to the tally.
      addCarton(parsed, profile.productName, profile.supplierName);
    },
    [session, pending, profiles, addCarton, showToast],
  );

  const confirmPending = useCallback(
    (product: string, supplier: string) => {
      if (!pending) return;
      const { parsed } = pending;
      const gtin = parsed.gtin!;
      const profile: GtinProfile = {
        gtin,
        productName: product,
        supplierName: supplier,
        fingerprint: parsed.fingerprint ?? '',
        updatedAt: new Date().toISOString(),
      };
      setProfiles(upsertProfile(profile));
      addCarton(parsed, product, supplier);
      setPending(null);
    },
    [pending, addCarton],
  );

  const removeCarton = useCallback(
    (id: string) => {
      setSession((prev) => (prev ? { ...prev, cartons: prev.cartons.filter((c) => c.id !== id) } : prev));
    },
    [setSession],
  );

  // --- session lifecycle --------------------------------------------------

  const startSession = useCallback(
    (receiptRef: string, expectation: ReceiptExpectation) => {
      setSession({
        id: uid(),
        receiptRef,
        startedAt: new Date().toISOString(),
        scannedBy,
        expectation,
        cartons: [],
      });
    },
    [scannedBy, setSession],
  );

  const endSession = useCallback(() => {
    setSession(null);
    setSettingsOpen(false);
    lastDecodeRef.current = { raw: '', time: 0 };
  }, [setSession]);

  const handleExport = useCallback(async () => {
    if (!session || session.cartons.length === 0) {
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
      <SessionSetup
        scannedBy={scannedBy}
        onStart={startSession}
        onEditName={() => setEditingName(true)}
      />
    );
  }

  const last = session.cartons.at(-1);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-3">
      <header className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{session.receiptRef}</div>
          <div className="text-xs text-slate-400">by {scannedBy}</div>
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

      <ScannerView active paused={!!pending} onDecode={handleDecode} />

      <Readout
        totalKg={variance!.receivedKg}
        cartonCount={variance!.receivedCartons}
        mixedUnits={variance!.mixedUnits}
        lastWeightKg={last?.weightKg}
        lastUnit={last?.unit}
        lastNetWeight={last?.netWeight}
      />

      <VarianceBar variance={variance!} />

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="export"
          onClick={handleExport}
          className="flex-1 rounded-xl bg-sky-500 py-3 text-base font-bold text-slate-900 active:bg-sky-400"
        >
          ⬇ Export to Excel
        </button>
      </div>

      <DevPanel onSimulate={handleDecode} />

      <CartonList cartons={session.cartons} onRemove={removeCarton} />

      {pending && (
        <ConfirmSheet pending={pending} onConfirm={confirmPending} onCancel={() => setPending(null)} />
      )}

      {settingsOpen && (
        <SettingsMenu
          scannedBy={scannedBy}
          receiptRef={session.receiptRef}
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
