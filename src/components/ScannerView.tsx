import { useEffect, useRef, useState } from 'react';
import {
  CameraError,
  preloadScanner,
  runScanLoop,
  startCamera,
  stopCamera,
} from '../lib/scanner';
import { onOcrProgress, preloadOcr, recognizeVideoRegion, type OcrRead } from '../lib/ocr';

export type ScanMode = 'barcode' | 'ocr';

interface ScannerViewProps {
  /** Whether the camera should be live. */
  active: boolean;
  /** When true the camera stays on but decoding is suspended (e.g. confirm open). */
  paused: boolean;
  /** Barcode (default) or OCR weight capture. */
  mode: ScanMode;
  /** Fired with each decoded CODE-128 string (barcode mode). */
  onDecode: (raw: string) => void;
  /** Fired with each OCR read of the capture region (OCR mode). */
  onOcrRead: (read: OcrRead) => void;
  /** Latest OCR capture feedback (e.g. "✓ 41.1 lb → 18.64 kg"). */
  ocrFeedback?: string;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';
type OcrStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Live rear-camera view with two capture loops: the ZBar barcode loop, or the
 * Tesseract OCR loop reading a printed weight from a focused capture region.
 * Loops are torn down while `paused` (a confirm sheet is open) but the camera
 * stream stays warm so resuming is instant.
 */
export function ScannerView({ active, paused, mode, onDecode, onOcrRead, ocrFeedback }: ScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>('');
  const [retryNonce, setRetryNonce] = useState(0);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>('idle');

  // Camera + zbar wasm lifecycle. Re-runs on `retryNonce` bump (Retry button).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setStatus('loading');
    setError('');

    (async () => {
      try {
        await preloadScanner();
        const video = videoRef.current;
        if (!video || cancelled) return;
        streamRef.current = await startCamera(video);
        if (cancelled) {
          stopCamera(streamRef.current);
          streamRef.current = null;
          return;
        }
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof CameraError ? err.message : `Scanner failed to start: ${String(err)}`);
      }
    })();

    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [active, retryNonce]);

  // Recover the camera after backgrounding / phone lock: iOS ends the stream's
  // tracks, leaving a black view. When the app returns to the foreground and
  // the track is dead, bounce the lifecycle effect to restart the stream.
  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // Small delay: iOS briefly reports tracks muted right at resume.
      setTimeout(() => {
        const tracks = streamRef.current?.getVideoTracks() ?? [];
        const dead = tracks.length === 0 || tracks.some((t) => t.readyState === 'ended');
        if (dead) setRetryNonce((n) => n + 1);
      }, 400);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active]);

  const [ocrLoadMsg, setOcrLoadMsg] = useState('');

  // Lazy-load the OCR engine the first time OCR mode is enabled.
  useEffect(() => {
    if (mode !== 'ocr' || !active || ocrStatus === 'ready' || ocrStatus === 'loading') return;
    let cancelled = false;
    setOcrStatus('loading');
    setOcrLoadMsg('');
    onOcrProgress((msg) => {
      if (!cancelled) setOcrLoadMsg(msg);
    });
    preloadOcr()
      .then(() => {
        if (!cancelled) setOcrStatus('ready');
      })
      .catch((err) => {
        console.warn('OCR engine failed to load:', err);
        if (!cancelled) setOcrStatus('error');
      })
      .finally(() => {
        onOcrProgress(null);
      });
    return () => {
      cancelled = true;
      onOcrProgress(null);
    };
  }, [mode, active, ocrStatus]);

  // Barcode scan loop.
  useEffect(() => {
    if (mode !== 'barcode' || status !== 'ready' || paused || !active) return;
    const video = videoRef.current;
    if (!video) return;
    const stop = runScanLoop({
      video,
      onDecode,
      onError: (err) => console.warn('scan tick failed:', err),
    });
    return stop;
  }, [mode, status, paused, active, onDecode]);

  // OCR capture loop: recognitions run back-to-back with a short breather
  // (Tesseract takes a few hundred ms per frame; a busy-wait guard is implicit
  // in the sequential await).
  useEffect(() => {
    if (mode !== 'ocr' || status !== 'ready' || ocrStatus !== 'ready' || paused || !active) return;
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    const canvas = document.createElement('canvas');
    let consecutiveErrors = 0;
    (async () => {
      while (!stopped) {
        try {
          const read = await recognizeVideoRegion(video, canvas);
          consecutiveErrors = 0;
          if (stopped) break;
          if (read && read.text) onOcrRead(read);
        } catch (err) {
          console.warn('OCR tick failed:', err);
          // A dead worker would otherwise spin (and burn battery) forever;
          // after repeated failures surface the error state with its Retry.
          consecutiveErrors += 1;
          if (consecutiveErrors >= 5) {
            if (!stopped) setOcrStatus('error');
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [mode, status, ocrStatus, paused, active, onOcrRead]);

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black ring-1 ring-slate-700">
      <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

      {/* Barcode reticle */}
      {status === 'ready' && mode === 'barcode' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`h-28 w-4/5 rounded-xl border-2 ${
              paused ? 'border-amber-400/70' : 'border-emerald-400/80'
            }`}
          />
        </div>
      )}

      {/* OCR capture box (slightly smaller than the actual crop region — see OCR_REGION) */}
      {status === 'ready' && mode === 'ocr' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="rounded-full bg-slate-900/70 px-3 py-1 text-xs font-medium text-sky-200">
            Align the printed weight in the box
          </span>
          <div
            className={`h-[15%] w-2/3 rounded-lg border-2 ${
              paused ? 'border-amber-400/70' : 'border-sky-400/90'
            }`}
          />
          {ocrFeedback && (
            <span className="max-w-[90%] truncate rounded-full bg-slate-900/80 px-3 py-1 text-sm font-semibold text-emerald-300">
              {ocrFeedback}
            </span>
          )}
          {ocrStatus === 'loading' && (
            <span className="rounded-full bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
              Loading OCR engine…{ocrLoadMsg ? ` (${ocrLoadMsg})` : ''}
            </span>
          )}
        </div>
      )}

      {/* OCR engine failed (camera itself is fine) */}
      {status === 'ready' && mode === 'ocr' && ocrStatus === 'error' && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={() => setOcrStatus('idle')}
            className="pointer-events-auto rounded-full bg-rose-500/90 px-4 py-1.5 text-xs font-semibold text-white"
          >
            OCR engine failed to load — tap to retry
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80 text-slate-300">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400" />
          <span className="text-sm">Loading scanner…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/90 p-5 text-center">
          <span className="text-3xl">📷</span>
          <p className="text-sm text-rose-300">{error}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-900 active:bg-emerald-400"
          >
            Retry camera
          </button>
        </div>
      )}

      {paused && status === 'ready' && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-semibold text-slate-900">
          Paused — confirm carton
        </div>
      )}
    </div>
  );
}
