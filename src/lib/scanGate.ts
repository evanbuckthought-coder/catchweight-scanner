/**
 * Sliding-window repeat gate for continuous camera decoding.
 *
 * The camera decodes several times a second, and one label can carry MORE
 * THAN ONE readable barcode (Ingham chicken labels print three). The old
 * "last raw only" window let two barcodes on a single label ALTERNATE:
 * A processes → B takes over the window slot → A looks new and processes
 * again… — which mass-counted one hovered label in the field (90+ entries,
 * a tonne of phantom weight, from two labels).
 *
 * This gate tracks a window PER RAW VALUE: every sighting refreshes that
 * raw's own timer, so a barcode only re-processes after it has been out of
 * view for the full window — no matter what else is decoded in between.
 */
export interface ScanGate {
  /**
   * True if this decode should be processed. Every call refreshes the raw's
   * window, so repeated sightings keep it closed while the label is in view.
   */
  admit(raw: string, now?: number): boolean;
  /** Forget everything (leaving/re-entering a screen, new session). */
  reset(): void;
}

export function createScanGate(windowMs: number): ScanGate {
  const lastSeen = new Map<string, number>();
  return {
    admit(raw: string, now: number = Date.now()): boolean {
      const prev = lastSeen.get(raw);
      lastSeen.set(raw, now);
      // Housekeeping so an all-day session can't grow the map unbounded.
      if (lastSeen.size > 200) {
        for (const [k, t] of lastSeen) {
          if (now - t > windowMs) lastSeen.delete(k);
        }
      }
      return prev === undefined || now - prev >= windowMs;
    },
    reset() {
      lastSeen.clear();
    },
  };
}
