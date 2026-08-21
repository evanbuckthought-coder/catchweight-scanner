/**
 * Client side of "Teach a new label": downscale/compress the photo on-device,
 * then POST it to /api/teach-label with the shared-secret header.
 *
 * Cost/usage rules baked in here:
 *  - the image is capped at ~1600 px longest edge + JPEG-compressed BEFORE
 *    upload, so every teach costs roughly the same small amount;
 *  - one in-flight request at a time (see TeachLabelFlow) and no automatic
 *    or background calls anywhere — a teach happens only on explicit tap.
 */

import {
  TEACH_MAX_IMAGE_BASE64,
  TEACH_SECRET_HEADER,
  type TeachMediaType,
  type TeachResult,
} from './teachShared';
import type { CartonRead } from './barcodeTeachShared';

/**
 * Shared secret sent as the x-teach-secret header. Like the passcode, this
 * lives in the client bundle by design — it is a basic abuse guard (stops the
 * public endpoint being farmed as a free AI proxy), not real auth. The
 * TEACH_SHARED_SECRET env var in Vercel must be set to this exact value.
 */
export const TEACH_SECRET = 'cw-teach-903c3bb2759f9b90a87415ae5b6c7b4f';

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;
/**
 * Re-encode steps used if the first pass is still too big for the endpoint.
 * A 4-figure-megapixel phone photo of a glossy label can stay large even at
 * q0.8, and an oversized body is rejected before any AI call is made — so we
 * shrink rather than fire a request that is guaranteed to fail.
 */
const FALLBACK_STEPS: { edge: number; quality: number }[] = [
  { edge: 1280, quality: 0.72 },
  { edge: 1024, quality: 0.65 },
  { edge: 800, quality: 0.6 },
];

export interface CompressedLabelImage {
  base64: string; // no data: prefix
  mediaType: TeachMediaType;
  width: number;
  height: number;
  /** Approximate encoded size in bytes (for the review screen). */
  bytes: number;
}

/** Decode a picked/taken photo, honouring EXIF orientation where supported. */
async function decodeImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation:'from-image' bakes EXIF rotation in (Safari 16+/Chrome).
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
        createImageBitmap(file),
      );
      return { source: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() };
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = url;
  });
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

/**
 * Downscale to ≤MAX_EDGE px on the longest side and re-encode as JPEG.
 * Keeps the AI call cheap and the upload small on warehouse connectivity.
 */
export async function compressLabelImage(file: Blob): Promise<CompressedLabelImage> {
  const { source, width, height, cleanup } = await decodeImage(file);
  try {
    if (!width || !height) {
      throw new Error('That photo has no image data — take it again.');
    }

    const encode = (maxEdge: number, quality: number): CompressedLabelImage => {
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable on this device');
      ctx.drawImage(source, 0, 0, w, h);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (!dataUrl.startsWith('data:image/jpeg')) {
        throw new Error('This device could not encode the photo — try again.');
      }
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      return { base64, mediaType: 'image/jpeg', width: w, height: h, bytes: Math.round(base64.length * 0.75) };
    };

    let out = encode(MAX_EDGE, JPEG_QUALITY);
    // Shrink until it comfortably fits the endpoint's cap, rather than
    // sending a body that will be refused.
    for (const step of FALLBACK_STEPS) {
      if (out.base64.length <= TEACH_MAX_IMAGE_BASE64) break;
      out = encode(step.edge, step.quality);
    }
    if (out.base64.length > TEACH_MAX_IMAGE_BASE64) {
      throw new Error('That photo is too large even after compression — take a closer, tighter shot of the label.');
    }
    if (out.base64.length < 1024) {
      throw new Error('That photo came out blank — take it again with the label in frame.');
    }
    return out;
  } finally {
    cleanup();
  }
}

/** Error whose message is safe to show verbatim on the teach screen. */
export class TeachError extends Error {}

/**
 * One POST to the teach endpoint, with the failure message the operator will
 * actually see.
 *
 * The upstream `detail` is appended when present: a bare "AI service error
 * (400)" is undiagnosable on a phone in a chiller, whereas the real message
 * ("...property 'minimum' is not supported") points straight at the cause.
 */
async function postTeach<T>(body: Record<string, unknown>, offlineMessage: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/teach-label', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TEACH_SECRET_HEADER]: TEACH_SECRET,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TeachError(offlineMessage);
  }

  const parsed = (await res.json().catch(() => null)) as
    | { ok?: boolean; result?: T; error?: string; detail?: string }
    | null;

  if (!res.ok || !parsed?.ok || !parsed.result) {
    const base = parsed?.error ?? `Analysis failed (HTTP ${res.status}) — try again.`;
    const detail = parsed?.detail?.trim();
    if (detail) console.warn('teach endpoint detail:', detail);
    throw new TeachError(detail ? `${base}\n\nDetail: ${detail}` : base);
  }
  return parsed.result;
}

/**
 * Send the compressed label photo (+ optional hint) for analysis.
 * Needs connectivity; takes a few seconds. Throws TeachError with a
 * user-facing message on any failure — nothing is saved by this call.
 */
export async function analyseLabel(
  image: CompressedLabelImage,
  hint: string | undefined,
): Promise<TeachResult> {
  return postTeach<TeachResult>(
    {
      image: image.base64,
      mediaType: image.mediaType,
      ...(hint?.trim() ? { hint: hint.trim() } : {}),
    },
    'No connection — teaching needs internet. Check connectivity and retry.',
  );
}

/**
 * Ask the AI to work out a non-GS1 barcode's FORMAT MAP from the label photo.
 *
 * `digits` MUST be the exact string the scanner read — it is sent so the model
 * can locate the printed values inside it. What comes back is structure only
 * (positions/encodings); the caller re-decodes the scanner's own digits
 * on-device and validates before anything is saved or counted.
 */
export async function analyseBarcode(image: CompressedLabelImage, digits: string): Promise<unknown> {
  return postTeach<unknown>(
    { mode: 'barcode', image: image.base64, mediaType: image.mediaType, digits },
    'No connection — analysing a barcode needs internet. Check connectivity and retry.',
  );
}

/**
 * UNSCANNABLE barcode: read THIS carton's printed values off the photo.
 *
 * There is no scanned digit string here, so no format map can be (or is)
 * learned. Everything returned is a PROPOSAL for the human to confirm, and the
 * resulting carton is recorded as AI-assisted, never as a scanned value.
 */
export async function readCarton(image: CompressedLabelImage): Promise<CartonRead> {
  return postTeach<CartonRead>(
    { mode: 'carton', image: image.base64, mediaType: image.mediaType },
    'No connection — reading a label needs internet. Check connectivity and retry.',
  );
}
