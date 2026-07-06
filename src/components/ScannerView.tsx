import { useEffect, useRef, useState } from 'react';
import {
  CameraError,
  preloadScanner,
  runScanLoop,
  startCamera,
  stopCamera,
} from '../lib/scanner';
import { OCR_REGION, recognizeVideoRegion, type OcrRead, type OcrRegion } from '../lib/ocr';
import { useOcrEngine } from '../hooks/useOcrEngine';

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
  /** OCR crop region from the taught label profile (defaults to centred). */
  ocrRegion?: OcrRegion;
  /** Active taught profile name — shown so a label mismatch is visible at a glance. */
  ocrProfileName?: string;
  /** Expected-format hint from the profile (e.g. `kg · 2 dp · near “NET WEIGHT”`). */
  ocrHint?: string;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Live rear-camera view with two capture loops: the ZBar barcode loop, or the
 * Tesseract OCR loop reading a printed weight from a focused capture region.
 * Loops are torn down while `paused` (a confirm sheet is open) but the camera
 * stream stays warm so resuming is instant.
 */
export function ScannerView({
  active,
  paused,
  mode,
  onDecode,
  onOcrRead,
  ocrFeedback,
  ocrRegion,
  ocrProfileName,
  ocrHint,
}: ScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>('');
  const [retryNonce, setRetryNonce] = useState(0);
  // Engine lifecycle lives in a dedicated (regression-tested) hook — see
  // useOcrEngine for why this must not be an inline effect.
  const ocr = useOcrEngine(mode === 'ocr' && active);

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

  // TAP-TO-CAPTURE OCR: one recognition of the current frame per explicit
  // tap. Replaced the old continuous loop, which churned on blurry/moving
  // frames and was slower per carton than typing — a single deliberately
  // lined-up still is both faster and more accurate.
  const [reading, setReading] = useState(false);
  const ocrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureOnce = async () => {
    if (reading || paused || status !== 'ready' || ocr.status !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;
    ocrCanvasRef.current ??= document.createElement('canvas');
    setReading(true);
    try {
      const read = await recognizeVideoRegion(video, ocrCanvasRef.current, ocrRegion ?? OCR_REGION);
      // Empty reads flow through too — the handler owns per-tap feedback.
      onOcrRead(read ?? { text: '', confidence: 0 });
    } catch (err) {
      console.warn('OCR capture failed:', err);
      ocr.fail('recognition failed — retry');
    } finally {
      setReading(false);
    }
  };

  return (
    <div
      data-ocr-engine={mode === 'ocr' ? ocr.status : undefined}
      className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black ring-1 ring-slate-700"
    >
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

      {/* OCR overlay: capture box positioned per the taught label's weight
          region (visually ~92%/75% of the true crop — see OCR_REGION), with
          the active profile + expected format pinned at the top so a label
          mismatch is visible at a glance. */}
      {status === 'ready' &&
        mode === 'ocr' &&
        (() => {
          const region = ocrRegion ?? OCR_REGION;
          const boxW = region.widthFrac * 0.92;
          const boxH = region.heightFrac * 0.75;
          return (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-2 flex flex-col items-center gap-1 px-2">
                {ocrProfileName && (
                  <span
                    data-testid="ocr-active-profile"
                    className="max-w-full truncate rounded-full bg-indigo-500/80 px-3 py-1 text-xs font-semibold text-white"
                  >
                    🏷 {ocrProfileName}
                  </span>
                )}
                <span className="max-w-full truncate rounded-full bg-slate-900/70 px-3 py-1 text-xs font-medium text-sky-200">
                  {ocrHint ? `Expecting ${ocrHint}` : 'Line the printed weight up in the box'}
                </span>
              </div>
              <div
                data-testid="ocr-box"
                className={`absolute rounded-lg border-2 ${
                  paused ? 'border-amber-400/70' : reading ? 'border-emerald-400' : 'border-sky-400/90'
                }`}
                style={{
                  left: `${(region.centerXFrac - boxW / 2) * 100}%`,
                  top: `${(region.centerYFrac - boxH / 2) * 100}%`,
                  width: `${boxW * 100}%`,
                  height: `${boxH * 100}%`,
                }}
              />
              <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-1 px-2">
                {ocrFeedback && (
                  <span className="max-w-[90%] truncate rounded-full bg-slate-900/80 px-3 py-1 text-sm font-semibold text-emerald-300">
                    {ocrFeedback}
                  </span>
                )}
                {ocr.status === 'loading' && (
                  <span className="rounded-full bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
                    Loading OCR engine…{ocr.message ? ` (${ocr.message})` : ''}
                  </span>
                )}
              </div>
              {ocr.status === 'ready' && !paused && (
                <div className="absolute inset-x-0 bottom-3 flex justify-center">
                  <button
                    type="button"
                    data-testid="ocr-capture"
                    disabled={reading}
                    onClick={() => void captureOnce()}
                    className="pointer-events-auto rounded-full bg-emerald-500 px-8 py-3 text-base font-bold text-slate-900 shadow-lg shadow-black/40 active:bg-emerald-400 disabled:opacity-70"
                  >
                    {reading ? '🔍 Reading…' : '📸 Capture weight'}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

      {/* OCR engine failed (camera itself is fine) */}
      {status === 'ready' && mode === 'ocr' && ocr.status === 'error' && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={ocr.retry}
            className="pointer-events-auto max-w-[92%] rounded-full bg-rose-500/90 px-4 py-1.5 text-xs font-semibold text-white"
          >
            OCR engine failed{ocr.message ? ` (${ocr.message})` : ''} — tap to retry
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
