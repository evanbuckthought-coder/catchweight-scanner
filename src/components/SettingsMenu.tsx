import { useState } from 'react';
import { runOcrDiagnostics, type OcrDiagStep } from '../lib/ocr';

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

interface SettingsMenuProps {
  scannedBy: string;
  poRef: string;
  devTools: boolean;
  onToggleDevTools: (on: boolean) => void;
  onChangeName: (name: string) => void;
  onEndSession: () => void;
  onClose: () => void;
}

/** Small settings sheet: edit operator name, test tools, end the current session. */
export function SettingsMenu({
  scannedBy,
  poRef,
  devTools,
  onToggleDevTools,
  onChangeName,
  onEndSession,
  onClose,
}: SettingsMenuProps) {
  const [name, setName] = useState(scannedBy);
  const [confirmEnd, setConfirmEnd] = useState(false);
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="rounded-t-3xl bg-slate-900 p-5 pb-8 ring-1 ring-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-600" />
        <h2 className="text-lg font-bold">Settings</h2>
        <p className="text-xs text-slate-400">PO: {poRef}</p>

        <label className="mt-4 block text-sm font-medium text-slate-300">
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

        {/* Test tools are OFF by default in production so a stray tap can't
            insert a simulated carton into a real receiving session. */}
        <label className="mt-4 flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-3 ring-1 ring-slate-700">
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

        <div className="mt-6">
          {!confirmEnd ? (
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              className="w-full rounded-xl bg-rose-500/20 py-3 text-base font-semibold text-rose-300 ring-1 ring-rose-500/40"
            >
              End session
            </button>
          ) : (
            <div className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
              <p className="text-sm text-rose-200">
                End and clear this session? Export first if you need the data.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmEnd(false)}
                  className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-medium text-slate-200"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={onEndSession}
                  className="flex-1 rounded-lg bg-rose-500 py-2 text-sm font-bold text-slate-900"
                >
                  End session
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-200"
        >
          Close
        </button>

        {/* On-device OCR self-test: pinpoints which stage of the engine load
            fails on THIS device (iOS-PWA failures are invisible from desktop). */}
        <div className="mt-4 rounded-xl bg-slate-800/60 p-3 ring-1 ring-slate-700">
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

        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
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
    </div>
  );
}
