/**
 * OCR weight-capture engine (Tesseract compiled to WASM) + weight-text parsing.
 *
 * Used when a product's barcodes don't carry weight: the operator switches to
 * "OCR weight mode" and points the capture box at the printed net weight. The
 * flow mirrors barcode scanning — continuous reads, auto-accept on a clean
 * read, interrupt only on a suspicious one (see lib/guardrails.ts + App).
 *
 * The Tesseract worker, core wasm and language data are lazy-loaded on first
 * enable (tesseract.js fetches them from its CDN by default) so none of it
 * weighs down the initial bundle. parseWeightText() is pure and unit-tested.
 */

import type { Worker as TesseractWorker } from 'tesseract.js';
import type { ParsedCarton } from './gs1';
import { toKg, type WeightUnit } from './units';

/** Reads below this Tesseract confidence (0-100) are treated as failed. */
export const OCR_MIN_CONFIDENCE = 70;

/**
 * Capture region as fractions of the camera frame, centred. Slightly larger
 * than the on-screen guide box: the <video> is displayed object-cover, so the
 * visible box and the true frame region don't align exactly — a generous crop
 * keeps the weight inside the OCR'd area.
 */
export const OCR_REGION = { widthFrac: 0.72, heightFrac: 0.2 };

let workerPromise: Promise<TesseractWorker> | null = null;

let warmed = false;

/**
 * Best-effort OCR cache warm-up — call once per app open, while connectivity
 * is likely. Downloads (through the service worker, which caches them) every
 * file OCR mode needs offline, WITHOUT booting the engine:
 *
 *  - the lazy tesseract.js chunk. Critical: every deploy gives it a NEW
 *    hashed URL, so after an app update the old cached copy no longer counts —
 *    without this warm-up, the first OCR use after an update needs reception
 *    ("Importing a module script failed" in a dead-zone coolstore).
 *  - worker.min.js, the WASM core this device will pick (same feature
 *    detection tesseract uses), and the language data. Stable URLs — these
 *    stay cached across deploys, so re-warming them costs no data.
 *
 * Failures are swallowed: offline at open simply means no warm-up this time.
 */
export async function warmOcrCache(): Promise<void> {
  if (warmed) return;
  warmed = true;
  try {
    await import('tesseract.js');
    const { simd, relaxedSimd } = await import('wasm-feature-detect');
    const core = (await relaxedSimd())
      ? 'tesseract-core-relaxedsimd-lstm.wasm.js'
      : (await simd())
        ? 'tesseract-core-simd-lstm.wasm.js'
        : 'tesseract-core-lstm.wasm.js';
    const abs = (path: string) => new URL(path, window.location.origin).href;
    await Promise.allSettled([
      fetch(abs('/tesseract/worker.min.js')),
      fetch(abs(`/tesseract/core/${core}`)),
      fetch(abs('/tesseract/lang/eng.traineddata.gz')),
    ]);
  } catch {
    warmed = false; // let a later call retry (e.g. next app open online)
  }
}

/** Optional listener for engine-load progress (shown in the loading UI). */
let progressListener: ((message: string) => void) | null = null;
export function onOcrProgress(listener: ((message: string) => void) | null): void {
  progressListener = listener;
}

/** Max time the engine load may take before it fails with a retryable error. */
const OCR_LOAD_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('OCR engine load timed out — check connection and retry')), ms),
    ),
  ]);
}

/** Lazy-create the shared Tesseract worker. Failure resets so retry works. */
export function preloadOcr(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = withTimeout(
      (async () => {
        const { createWorker, PSM } = await import('tesseract.js');
        // Self-hosted engine assets (copied from the tesseract.js / .js-core /
        // @tesseract.js-data packages into public/tesseract). Same-origin means
        // the service worker caches them after first use, so OCR mode keeps
        // working offline in warehouse dead-zones — no CDN dependency.
        //
        // IMPORTANT: these must be FULL absolute URLs (with origin), not bare
        // paths, so they resolve identically from any worker context.
        const abs = (path: string) => new URL(path, window.location.origin).href;
        progressListener?.('starting engine worker');
        const worker = await createWorker('eng', undefined, {
          workerPath: abs('/tesseract/worker.min.js'),
          corePath: abs('/tesseract/core'),
          langPath: abs('/tesseract/lang'),
          // iOS/WebKit: tesseract's default blob-URL worker bootstrap fails
          // SILENTLY in service-worker-controlled pages (installed PWAs) — the
          // worker never starts and the load hangs with zero progress. Load
          // the worker script directly from its same-origin URL instead.
          workerBlobURL: false,
          errorHandler: (err: unknown) => {
            console.warn('OCR worker error:', err);
            progressListener?.(`worker error: ${String(err)}`);
          },
          logger: (m: { status?: string; progress?: number }) => {
            if (m?.status && progressListener) {
              const pct = typeof m.progress === 'number' ? ` ${Math.round(m.progress * 100)}%` : '';
              progressListener(`${m.status}${pct}`);
            }
          },
        });
        await worker.setParameters({
          // The weight is one printed line; constrain the page-seg model to match.
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          // Whitelist is best-effort (ignored by the LSTM engine on some builds);
          // parseWeightText() re-filters, so this is belt-and-braces only.
          tessedit_char_whitelist: '0123456789.,kglbsKGLBS# ',
        });
        return worker;
      })(),
      OCR_LOAD_TIMEOUT_MS,
    ).catch((err) => {
      workerPromise = null; // allow a retry after e.g. a network failure
      throw err;
    });
  }
  return workerPromise;
}

export interface OcrRead {
  text: string;
  /** Tesseract mean confidence, 0-100. */
  confidence: number;
}

export interface OcrDiagStep {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * On-device OCR self-test. Every OCR failure in this project has been
 * iOS-PWA-specific and invisible from desktop browsers — this runs the load
 * chain stage by stage ON THE DEVICE and reports exactly where it breaks:
 * asset fetches (through the live service worker), raw worker spawn, then the
 * full engine load + a synthetic recognition.
 */
export async function runOcrDiagnostics(onStep: (s: OcrDiagStep) => void): Promise<void> {
  const abs = (path: string) => new URL(path, window.location.origin).href;

  const timed = async (step: string, fn: () => Promise<string>): Promise<void> => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      onStep({ step, ok: true, detail: `${detail} · ${((Date.now() - t0) / 1000).toFixed(1)}s` });
    } catch (err) {
      onStep({
        step,
        ok: false,
        detail: `${err instanceof Error ? err.message : String(err)} · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      });
    }
  };

  const timeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);

  const fetchCheck = (label: string, path: string) =>
    timed(label, async () => {
      const r = await timeout(fetch(abs(path)), 20_000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = await timeout(r.arrayBuffer(), 20_000);
      return `${Math.round(buf.byteLength / 1024)} KB`;
    });

  await fetchCheck('Worker script fetch', '/tesseract/worker.min.js');
  await fetchCheck('WASM core fetch', '/tesseract/core/tesseract-core-simd-lstm.wasm.js');
  await fetchCheck('Language data fetch', '/tesseract/lang/eng.traineddata.gz');

  await timed('Worker spawn', () =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      let w: Worker | null = null;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
        try {
          w?.terminate();
        } catch {
          /* ignore */
        }
      };
      try {
        w = new Worker(abs('/tesseract/worker.min.js'));
        w.onerror = (e) => done(() => reject(new Error(e.message || 'worker error event')));
        // worker.min.js sends nothing unprompted; no error event shortly after
        // spawn means the script loaded and parsed in a real worker context.
        setTimeout(() => done(() => resolve('spawned, no error after 3s')), 3000);
      } catch (err) {
        done(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    }),
  );

  await timed('Full engine load + test read', async () => {
    const worker = await preloadOcr(); // has its own 60s timeout
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas 2d context');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 300, 80);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 40px Arial';
    ctx.fillText('12.34 kg', 40, 55);
    const { data } = await timeout(worker.recognize(canvas), 30_000);
    return `read "${data.text.trim()}" @ ${Math.round(data.confidence)}%`;
  });
}

/**
 * Crop the central capture region from the live video frame and OCR it.
 * Small frames are upscaled — Tesseract reads print better at higher dpi.
 */
export async function recognizeVideoRegion(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<OcrRead | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const rw = vw * OCR_REGION.widthFrac;
  const rh = vh * OCR_REGION.heightFrac;
  const rx = (vw - rw) / 2;
  const ry = (vh - rh) / 2;
  const scale = rw < 600 ? 600 / rw : 1;
  canvas.width = Math.round(rw * scale);
  canvas.height = Math.round(rh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, rx, ry, rw, rh, 0, 0, canvas.width, canvas.height);

  const worker = await preloadOcr();
  const { data } = await worker.recognize(canvas);
  return { text: (data.text ?? '').trim(), confidence: data.confidence ?? 0 };
}

export interface OcrWeight {
  value: number;
  unit: WeightUnit;
  /** True when the read value carried a decimal point (expected catchweight shape). */
  hasDecimal: boolean;
  /**
   * True when a unit token (kg/lb/#) was actually read from the label. When
   * false the unit is a GUESS — the caller must not auto-accept (a lb label
   * read without its unit would otherwise enter the tally as kg, off by 2.2x).
   */
  unitExplicit: boolean;
}

/**
 * Extract a weight-like value from OCR text. Prefers a number immediately
 * followed by a unit (kg/lb/#); otherwise the first number with a decimal;
 * otherwise the first number. Commas are treated as decimal points (EU labels).
 * Integers up to 4 digits are accepted on purpose — a missed decimal ("1864")
 * must be *captured* so the guardrails can flag it, not silently dropped.
 *
 * hasDecimal keys SOLELY on the presence of a "." in the read value — never on
 * how many digits follow it. "18.00", "18.0", "18.02", "18.643" and even a
 * trailing-dot "18." all count as having a decimal; only a bare integer ("18",
 * "186") does not — that absence is the signature of OCR dropping the decimal.
 * The token regex therefore accepts ANY number of decimal digits (incl. zero).
 */
export function parseWeightText(text: string): OcrWeight | null {
  const cleaned = text.replace(/,/g, '.');

  let numStr: string | undefined;
  let unit: WeightUnit;
  let unitExplicit = true;

  const nearUnit = cleaned.match(/(?<!\d)(\d{1,4}(?:\.\d*)?)\s*(kg|lbs?|#)/i);
  if (nearUnit) {
    numStr = nearUnit[1];
    unit = /^k/i.test(nearUnit[2]) ? 'kg' : 'lb';
  } else {
    const all = [...cleaned.matchAll(/(?<!\d)\d{1,4}(?:\.\d*)?(?!\d)/g)].map((m) => m[0]);
    if (all.length === 0) return null;
    numStr = all.find((s) => s.includes('.')) ?? all[0];
    if (/lb/i.test(cleaned)) {
      unit = 'lb';
    } else if (/kg/i.test(cleaned)) {
      unit = 'kg';
    } else {
      unit = 'kg'; // guess — flagged so the caller forces a confirmation
      unitExplicit = false;
    }
  }

  const value = Number.parseFloat(numStr);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, unit, hasDecimal: numStr.includes('.'), unitExplicit };
}

/**
 * Wrap an OCR weight read as a ParsedCarton so it flows through the same
 * commit/confirm paths as a barcode scan. GTIN + batch inherit from the active
 * product (same default the manual sheet pre-fills); raw keeps the OCR text
 * for the audit trail.
 */
export function ocrToParsed(
  w: { value: number; unit: WeightUnit; text: string },
  opts: { gtin?: string; batch?: string } = {},
): ParsedCarton {
  return {
    raw: `OCR: "${w.text}"`,
    gtin: opts.gtin,
    companyPrefix: opts.gtin?.slice(0, 7),
    netWeight: w.value,
    weightUnit: w.unit,
    weightKg: toKg(w.value, w.unit),
    batch: opts.batch,
    traceId: opts.batch,
    traceAI: opts.batch ? '10' : undefined,
    fingerprint: 'ocr',
    elements: [],
    unknownAIs: [],
    errors: [],
    valid: true,
  };
}
