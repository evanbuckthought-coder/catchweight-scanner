import { useState } from 'react';
import { runOcrDiagnostics, type OcrDiagStep } from '../lib/ocr';
import { UNLOCK_FLAG_KEY } from '../lib/auth';

/**
 * Force-refresh the app: check for a new service worker, drop every runtime
 * cache, and hard-reload. Escape hatch for a stuck/stale installed PWA.
 * Session data lives in IndexedDB and localStorage — untouched by this.
 */
async function checkForUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn('Update check failed:', err);
  } finally {
    window.location.reload();
  }
}

interface SettingsScreenProps {
  scannedBy: string;
  onChangeName: (name: string) => void;
  devTools: boolean;
  onToggleDevTools: (on: boolean) => void;
  onBack: () => void;
}

/** Top-level Settings: operator name, passcode lock, test tools, diagnostics,
 *  app update / build info. Label knowledge lives in Label Intelligence. */
export function SettingsScreen({
  scannedBy,
  onChangeName,
  devTools,
  onToggleDevTools,
  onBack,
}: SettingsScreenProps) {
  const [name, setName] = useState(scannedBy);
  const [confirmLock, setConfirmLock] = useState(false);
  const [diagSteps, setDiagSteps] = useState<OcrDiagStep[] | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);

  const runDiagnostics = async () => {
    if (diagRunning) return;
    setDiagRunning(true);
    setDiagSteps([]);
    try {
      await runOcrDiagnostics((s) => setDiagSteps((prev) => [...(prev ?? []), s]));
    } finally {
      setDiagRunning(false);
    }
  };

  const lockNow = () => {
    try {
      localStorage.removeItem(UNLOCK_FLAG_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload(); // gate re-prompts for the passcode
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-slate-600"
        >
          ‹ Back
        </button>
        <h1 className="text-lg font-bold">Settings</h1>
        <span className="w-14" />
      </header>

      <label className="block text-sm font-medium text-slate-300">
        Operator name
        <div className="mt-1 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none"
          />
          <button
            type="button"
            disabled={!name.trim() || name.trim() === scannedBy}
            onClick={() => onChangeName(name.trim())}
            className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </label>

      {/* Passcode: the gate unlock is remembered per device; re-lock on demand. */}
      <div className="rounded-xl bg-slate-800/60 p-3 ring-1 ring-slate-700">
        <div className="text-sm font-medium text-slate-300">
          Passcode
          <span className="block text-xs font-normal text-slate-500">
            This device is unlocked. Lock it to require the passcode again on next open.
          </span>
        </div>
        {!confirmLock ? (
          <button
            type="button"
            data-testid="lock-app"
            onClick={() => setConfirmLock(true)}
            className="mt-2 w-full rounded-lg bg-slate-700 py-2.5 text-sm font-semibold text-slate-200"
          >
            🔒 Lock app now
          </button>
        ) : (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmLock(false)}
              className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={lockNow}
              className="flex-1 rounded-lg bg-rose-500 py-2.5 text-sm font-bold text-slate-900"
            >
              Lock
            </button>
          </div>
        )}
      </div>

      {/* Test tools are OFF by default in production so a stray tap can't
          insert a simulated carton into a real receiving session. */}
      <label className="flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-3 ring-1 ring-slate-700">
        <span className="text-sm font-medium text-slate-300">
          Test tools
          <span className="block text-xs font-normal text-slate-500">
            Simulated scans / OCR feeds (for demos — not for real receiving)
          </span>
        </span>
        <button
          type="button"
          data-testid="toggle-devtools"
          role="switch"
          aria-checked={devTools}
          onClick={() => onToggleDevTools(!devTools)}
          className={`h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors ${
            devTools ? 'bg-emerald-500' : 'bg-slate-600'
          }`}
        >
          <span
            className={`block h-6 w-6 rounded-full bg-white transition-transform ${
              devTools ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </label>

      {/* On-device OCR self-test: pinpoints which stage of the engine load
          fails on THIS device (iOS-PWA failures are invisible from desktop). */}
      <div className="rounded-xl bg-slate-800/60 p-3 ring-1 ring-slate-700">
        <button
          type="button"
          data-testid="ocr-diagnostics"
          disabled={diagRunning}
          onClick={runDiagnostics}
          className="w-full rounded-lg bg-slate-700 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-50"
        >
          {diagRunning ? 'Testing OCR engine…' : '🔍 Test OCR engine'}
        </button>
        {diagSteps && (
          <ul className="mt-2 flex flex-col gap-1">
            {diagSteps.map((s) => (
              <li key={s.step} className="text-xs">
                <span className={s.ok ? 'text-emerald-400' : 'text-rose-400'}>
                  {s.ok ? '✓' : '✗'} {s.step}
                </span>
                <span className="block break-words pl-4 text-slate-500">{s.detail}</span>
              </li>
            ))}
            {diagRunning && <li className="text-xs text-slate-500">running…</li>}
          </ul>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between pb-2 text-xs text-slate-500">
        <span data-testid="build-id">Build {__BUILD_ID__}</span>
        <button
          type="button"
          data-testid="check-update"
          onClick={checkForUpdate}
          className="rounded-lg bg-slate-800 px-3 py-1.5 font-medium text-slate-400 ring-1 ring-slate-700"
        >
          ⟳ Check for app update
        </button>
      </div>
    </div>
  );
}
