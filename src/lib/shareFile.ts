/**
 * Hand a generated file to the device share sheet (Web Share Level 2 — the
 * iOS mail/share action), falling back to a plain download where file sharing
 * isn't available. Shared by the Quick Count and Fresh Chicken exports.
 */

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function shareOrDownloadFile(blob: Blob, filename: string): Promise<ShareResult> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const file = new File([blob], filename, { type: blob.type });
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      // User dismissed the sheet — don't silently download behind their back.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Anything else (unsupported, transient) — fall through to a download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

/** Timestamp suffix for export filenames (YYYYMMDD_HHmm). */
export function fileStamp(when: string): string {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return 'export';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
