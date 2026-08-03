import { describe, it, expect } from 'vitest';
import { createScanGate } from './scanGate';

const WINDOW = 3000;

describe('createScanGate', () => {
  it('admits a barcode once, then blocks it while it stays in view', () => {
    const gate = createScanGate(WINDOW);
    expect(gate.admit('A', 0)).toBe(true);
    expect(gate.admit('A', 500)).toBe(false);
    expect(gate.admit('A', 2900)).toBe(false);
  });

  it('FIELD BUG: two barcodes on one label alternating admit each ONCE, not repeatedly', () => {
    // Hovering over a label whose GS1 barcode (A) and Lot ID barcode (B) are
    // both decodable — the decoder alternates A,B,A,B… The old last-raw-only
    // window re-admitted A on every alternation (90+ phantom cartons).
    const gate = createScanGate(WINDOW);
    let admittedA = 0;
    let admittedB = 0;
    for (let t = 0; t < 10_000; t += 150) {
      if (gate.admit('A', t)) admittedA++;
      if (gate.admit('B', t + 75)) admittedB++;
    }
    expect(admittedA).toBe(1);
    expect(admittedB).toBe(1);
  });

  it('sliding window: constant sightings never re-admit, a real gap does', () => {
    const gate = createScanGate(WINDOW);
    gate.admit('A', 0);
    for (let t = 1000; t <= 20_000; t += 1000) {
      expect(gate.admit('A', t)).toBe(false); // refreshed every second
    }
    expect(gate.admit('A', 20_000 + WINDOW)).toBe(true); // out of view 3s
  });

  it('different cartons (different raws) are unaffected by each other', () => {
    const gate = createScanGate(WINDOW);
    expect(gate.admit('carton1', 0)).toBe(true);
    expect(gate.admit('carton2', 100)).toBe(true);
    expect(gate.admit('carton3', 200)).toBe(true);
  });

  it('reset lets everything through again', () => {
    const gate = createScanGate(WINDOW);
    gate.admit('A', 0);
    gate.reset();
    expect(gate.admit('A', 1)).toBe(true);
  });

  it('housekeeping keeps the map bounded without evicting in-window entries', () => {
    const gate = createScanGate(WINDOW);
    gate.admit('hot', 0);
    for (let i = 0; i < 300; i++) gate.admit(`cold-${i}`, 1); // trip housekeeping
    // 'hot' is still within its window despite the sweep.
    expect(gate.admit('hot', 2)).toBe(false);
  });
});
