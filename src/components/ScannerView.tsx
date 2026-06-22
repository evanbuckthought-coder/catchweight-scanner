import { useEffect, useRef, useState } from 'react';
import {
  CameraError,
  preloadScanner,
  runScanLoop,
  startCamera,
  stopCamera,
} from '../lib/scanner';

interface ScannerViewProps {
  /** Whether the camera should be live. */
  active: boolean;
  /** When true the camera stays on but decoding is suspended (e.g. confirm open). */
  paused: boolean;
  /** Fired with each decoded CODE-128 string. */
  onDecode: (raw: string) => void;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Live rear-camera view with the ZBar scan loop. The loop is torn down while
 * `paused` so a confirm sheet isn't bombarded with repeat decodes, but the
 * camera stream stays warm so resuming is instant.
 */
export function ScannerView({ active, paused, onDecode }: ScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>('');
  const [retryNonce, setRetryNonce] = useState(0);

  // Camera + wasm lifecycle. Re-runs on `retryNonce` bump (the Retry button).
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

  // Scan loop — only while ready and not paused.
  useEffect(() => {
    if (status !== 'ready' || paused || !active) return;
    const video = videoRef.current;
    if (!video) return;
    const stop = runScanLoop({
      video,
      onDecode,
      onError: (err) => console.warn('scan tick failed:', err),
    });
    return stop;
  }, [status, paused, active, onDecode]);

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black ring-1 ring-slate-700">
      <video
        ref={videoRef}
        playsInline
        muted
        className="h-full w-full object-cover"
      />

      {/* Scan reticle */}
      {status === 'ready' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`h-28 w-4/5 rounded-xl border-2 ${
              paused ? 'border-amber-400/70' : 'border-emerald-400/80'
            }`}
          />
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
