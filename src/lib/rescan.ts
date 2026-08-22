/**
 * Is this scan the SAME PHYSICAL CARTON again, or a different carton whose
 * label happens to be identical?
 *
 * The answer depends entirely on whether the barcode carries a per-carton
 * unique identifier:
 *
 *  - WITH a serial (AI 21): the serial is unique per carton, so the same
 *    GTIN + serial twice is unambiguously a re-scan. Block it.
 *
 *  - WITHOUT a serial: identical strings across different cartons are normal,
 *    not suspicious. Fribin pork shoulder is the case that proved it — every
 *    carton of a batch prints
 *      (01)98420945798131(15)280223(3102)000771(10)602230529
 *    with the same GTIN, best-before, 7.71 kg net and batch. The per-carton
 *    number (26706830, 26706916, …) exists only in a separate barcode and in
 *    print, never in this string. Blocking the repeat silently UNDERCOUNTED a
 *    real carton, which is the worst failure this app has: a missing carton is
 *    invisible, whereas a double-count is on screen to be removed.
 *
 * So a serial-less repeat is COUNTED and flagged, never blocked. Accidental
 * double-fires of one carton are handled separately, by the short per-barcode
 * timing window in lib/scanGate.ts.
 */

/** The fields a scan (or an already-counted record) exposes for matching. */
export interface RescanFields {
  gtin?: string;
  serial?: string;
  raw?: string;
}

export type RescanVerdict<T> =
  /** Not seen before — count it silently. */
  | { kind: 'new' }
  /** Same carton, proven by its unique serial — BLOCK, and say which serial. */
  | { kind: 'duplicate'; serial: string; match: T }
  /** Identical label, but nothing in it can prove it's the same carton —
   *  COUNT it and tell the operator why it looked familiar. */
  | { kind: 'repeat'; match: T };

/**
 * Classify a scan against what's already counted. Pure; callers own the UI.
 *
 * Manual/OCR/AI records carry no raw string and never match, so keying a
 * carton by hand can never make the next scan look like a repeat.
 */
export function classifyRescan<T extends RescanFields>(
  existing: T[],
  probe: RescanFields,
): RescanVerdict<T> {
  // A serial is the only per-carton identifier these labels carry, so it is
  // the only thing that can prove a genuine re-scan.
  if (probe.serial && probe.gtin) {
    const match = existing.find((e) => e.gtin === probe.gtin && e.serial === probe.serial);
    if (match) return { kind: 'duplicate', serial: probe.serial, match };
    // A different serial on the same product is definitively a new carton —
    // no need to consider the raw string at all.
    return { kind: 'new' };
  }

  if (probe.raw) {
    const match = existing.find((e) => !!e.raw && e.raw === probe.raw);
    if (match) return { kind: 'repeat', match };
  }
  return { kind: 'new' };
}

/**
 * The notice shown when a serial-less label repeats. Deliberately explains the
 * cause, so an operator doesn't assume the app is double-counting.
 */
export const REPEAT_NOTICE =
  'Same barcode as an earlier carton — counted. This supplier’s labels aren’t unique per carton; remove it in the list if it was a double-scan.';

/** Why a scan was blocked — named, so a real block is distinguishable. */
export function duplicateReason(serial: string): string {
  return `Already scanned — duplicate serial ${serial} (this carton is already counted)`;
}
