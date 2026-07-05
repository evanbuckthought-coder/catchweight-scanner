import { useCallback, useEffect, useState } from 'react';
import { onOcrProgress, preloadOcr } from '../lib/ocr';

export type OcrEngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * OCR engine load lifecycle.
 *
 * Deliberately TWO effects: a kick-off effect (idle -> loading) and a load
 * effect that runs while status is 'loading'. A single effect that both
 * depends on the status and sets it cancels ITSELF: setting 'loading'
 * re-runs the effect, the cleanup flips its `cancelled` flag, and when the
 * engine finishes the `if (!cancelled) setStatus('ready')` is skipped — the
 * UI shows "Loading OCR engine…" forever even though the engine loaded fine.
 * That exact bug shipped and survived several rounds of (real but different)
 * engine fixes because nothing verified the UI state transition itself; see
 * useOcrEngine.test.tsx for the regression test.
 */
export function useOcrEngine(enabled: boolean): {
  status: OcrEngineStatus;
  message: string;
  retry: () => void;
  fail: (message: string) => void;
} {
  const [status, setStatus] = useState<OcrEngineStatus>('idle');
  const [message, setMessage] = useState('');

  // Kick-off: entering OCR mode while idle starts a load.
  useEffect(() => {
    if (enabled && status === 'idle') setStatus('loading');
  }, [enabled, status]);

  // Load: runs while 'loading'. Status doesn't change mid-load, so this
  // effect cannot cancel itself; cleanup only fires on unmount or completion.
  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;
    setMessage('');
    onOcrProgress((msg) => {
      if (!cancelled) setMessage(msg);
    });
    preloadOcr()
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((err) => {
        console.warn('OCR engine failed to load:', err);
        if (!cancelled) {
          const base = err instanceof Error ? err.message : String(err);
          // The engine downloads once per app update; a load failure with no
          // connectivity is almost always that download — say so plainly.
          setMessage(
            typeof navigator !== 'undefined' && navigator.onLine === false
              ? `${base} — no internet: the engine downloads once after an app update, connect briefly and retry`
              : base,
          );
          setStatus('error');
        }
      })
      .finally(() => {
        onOcrProgress(null);
      });
    return () => {
      cancelled = true;
      onOcrProgress(null);
    };
  }, [status]);

  const retry = useCallback(() => setStatus('idle'), []);

  /** Force the error state from outside (e.g. the scan loop's failure backoff). */
  const fail = useCallback((msg: string) => {
    setMessage(msg);
    setStatus('error');
  }, []);

  return { status, message, retry, fail };
}
