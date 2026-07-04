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
  TEACH_SECRET_HEADER,
  type TeachMediaType,
  type TeachResult,
} from './teachShared';

/**
 * Shared secret sent as the x-teach-secret header. Like the passcode, this
 * lives in the client bundle by design — it is a basic abuse guard (stops the
 * public endpoint being farmed as a free AI proxy), not real auth. The
 * TEACH_SHARED_SECRET env var in Vercel must be set to this exact value.
 */
export const TEACH_SECRET = 'cw-teach-903c3bb2759f9b90a87415ae5b6c7b4f';

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

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
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable on this device');
    ctx.drawImage(source, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return {
      base64,
      mediaType: 'image/jpeg',
      width: w,
      height: h,
      bytes: Math.round(base64.length * 0.75),
    };
  } finally {
    cleanup();
  }
}

/** Error whose message is safe to show verbatim on the teach screen. */
export class TeachError extends Error {}

/**
 * Send the compressed label photo (+ optional hint) for analysis.
 * Needs connectivity; takes a few seconds. Throws TeachError with a
 * user-facing message on any failure — nothing is saved by this call.
 */
export async function analyseLabel(
  image: CompressedLabelImage,
  hint: string | undefined,
): Promise<TeachResult> {
  let res: Response;
  try {
    res = await fetch('/api/teach-label', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TEACH_SECRET_HEADER]: TEACH_SECRET,
      },
      body: JSON.stringify({
        image: image.base64,
        mediaType: image.mediaType,
        ...(hint?.trim() ? { hint: hint.trim() } : {}),
      }),
    });
  } catch {
    throw new TeachError('No connection — teaching needs internet. Check connectivity and retry.');
  }

  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; result?: TeachResult; error?: string }
    | null;

  if (!res.ok || !body?.ok || !body.result) {
    throw new TeachError(body?.error ?? `Analysis failed (HTTP ${res.status}) — try again.`);
  }
  return body.result;
}
