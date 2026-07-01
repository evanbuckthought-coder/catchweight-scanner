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

/** Lazy-create the shared Tesseract worker. Failure resets so retry works. */
export function preloadOcr(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng');
      await worker.setParameters({
        // The weight is one printed line; constrain the page-seg model to match.
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        // Whitelist is best-effort (ignored by the LSTM engine on some builds);
        // parseWeightText() re-filters, so this is belt-and-braces only.
        tessedit_char_whitelist: '0123456789.,kglbsKGLBS# ',
      });
      return worker;
    })().catch((err) => {
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
}

/**
 * Extract a weight-like value from OCR text. Prefers a number immediately
 * followed by a unit (kg/lb/#); otherwise the first number with a decimal;
 * otherwise the first number. Commas are treated as decimal points (EU labels).
 * Integers up to 4 digits are accepted on purpose — a missed decimal ("1864")
 * must be *captured* so the guardrails can flag it, not silently dropped.
 */
export function parseWeightText(text: string): OcrWeight | null {
  const cleaned = text.replace(/,/g, '.');

  let numStr: string | undefined;
  let unit: WeightUnit;

  const nearUnit = cleaned.match(/(?<!\d)(\d{1,4}(?:\.\d{1,2})?)\s*(kg|lbs?|#)/i);
  if (nearUnit) {
    numStr = nearUnit[1];
    unit = /^k/i.test(nearUnit[2]) ? 'kg' : 'lb';
  } else {
    const all = [...cleaned.matchAll(/(?<!\d)\d{1,4}(?:\.\d{1,2})?(?!\d)/g)].map((m) => m[0]);
    if (all.length === 0) return null;
    numStr = all.find((s) => s.includes('.')) ?? all[0];
    unit = /lb/i.test(cleaned) ? 'lb' : 'kg';
  }

  const value = Number.parseFloat(numStr);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, unit, hasDecimal: numStr.includes('.') };
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
