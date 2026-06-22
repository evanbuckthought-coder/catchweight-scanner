/**
 * Camera + barcode decoding via ZBar compiled to WebAssembly.
 *
 * Why ZBar-WASM and not the browser BarcodeDetector API: BarcodeDetector is NOT
 * implemented in Safari/WebKit, so it silently no-ops on iOS — exactly the
 * device this app targets. Pure-JS decoders (ZXing/Quagga) are too slow/flaky
 * on dense Code 128. ZBar (native C, compiled to WASM) is the reliable path.
 *
 * We grab frames from a <video> element onto an offscreen canvas, hand the
 * ImageData to ZBar, and keep only CODE-128 symbols that the GS1 parser accepts.
 * If a carton stacks several barcodes, the caller's parser decides which decoded
 * string is a valid GS1-128 element list.
 */

import {
  scanImageData,
  getInstance,
  setModuleArgs,
  ZBarSymbolType,
  type ZBarSymbol,
} from '@undecaf/zbar-wasm';
// Load the wasm binary as a bundled, hashed asset URL (deterministic across
// hosts) rather than relying on the package's own import.meta.url resolution.
import wasmUrl from '@undecaf/zbar-wasm/dist/zbar.wasm?url';

let wasmReady: Promise<void> | null = null;

/** Preload + instantiate the ZBar wasm. Idempotent; call before scanning. */
export function preloadScanner(): Promise<void> {
  if (!wasmReady) {
    setModuleArgs({ locateFile: () => wasmUrl });
    wasmReady = getInstance().then(() => undefined);
  }
  return wasmReady;
}

export type CameraErrorKind = 'denied' | 'notfound' | 'insecure' | 'unsupported' | 'unknown';

export class CameraError extends Error {
  kind: CameraErrorKind;
  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.name = 'CameraError';
    this.kind = kind;
  }
}

/** Map a getUserMedia rejection to a friendly, actionable error. */
function toCameraError(err: unknown): CameraError {
  if (!window.isSecureContext) {
    return new CameraError(
      'insecure',
      'Camera needs a secure (https) context. On the phone open the app over https.',
    );
  }
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'denied',
        'Camera permission was denied. Re-enable it in Settings ▸ Safari ▸ Camera (or the AA menu ▸ Website Settings) and reload.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('notfound', 'No suitable camera was found on this device.');
    default:
      return new CameraError('unknown', `Could not start the camera: ${String(err)}`);
  }
}

/** Request the rear camera and attach the stream to a <video> element. */
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'This browser does not support camera access.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' }, // rear camera
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true'); // required so iOS doesn't go fullscreen
    video.muted = true;
    await video.play();
    return stream;
  } catch (err) {
    throw toCameraError(err);
  }
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Decode CODE-128 symbols from one video frame. Returns the decoded data
 * strings (control chars like the FNC1/GS separator preserved) for the caller
 * to parse. Reuses one canvas across calls.
 */
export async function scanVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<string[]> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return []; // stream not ready yet

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(video, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const symbols: ZBarSymbol[] = await scanImageData(imageData);
  return symbols
    .filter((s) => s.type === ZBarSymbolType.ZBAR_CODE128)
    .map((s) => s.decode());
}

export interface ScanLoopOptions {
  video: HTMLVideoElement;
  /** Called with every decoded CODE-128 string. */
  onDecode: (data: string) => void;
  /** Min ms between scan attempts (throttle CPU). Default 250ms. */
  intervalMs?: number;
  onError?: (err: unknown) => void;
}

/**
 * Run a continuous scan loop. Returns a stop() function. Guards against
 * overlapping scans (a slow decode won't queue up frames).
 */
export function runScanLoop(opts: ScanLoopOptions): () => void {
  const { video, onDecode, onError, intervalMs = 250 } = opts;
  const canvas = document.createElement('canvas');
  let stopped = false;
  let busy = false;
  let lastRun = 0;
  let rafId = 0;

  const tick = async (ts: number) => {
    if (stopped) return;
    if (!busy && ts - lastRun >= intervalMs) {
      lastRun = ts;
      busy = true;
      try {
        const results = await scanVideoFrame(video, canvas);
        for (const data of results) onDecode(data);
      } catch (err) {
        onError?.(err);
      } finally {
        busy = false;
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}
