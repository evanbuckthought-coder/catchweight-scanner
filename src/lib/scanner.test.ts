import { describe, it, expect } from 'vitest';
import { orderByGs1Preference, symbolInRegion, type ScanRegion } from './scanner';

/** The green capture box, roughly as laid out: wide, centred, short. */
const BOX: ScanRegion = { x: 0.07, y: 0.36, width: 0.86, height: 0.28 };
const W = 1280;
const H = 720;

/** Build a symbol's four corner points around a centre, in frame pixels. */
const sym = (cxFrac: number, cyFrac: number, wFrac = 0.4, hFrac = 0.06) => {
  const cx = cxFrac * W;
  const cy = cyFrac * H;
  const hw = (wFrac * W) / 2;
  const hh = (hFrac * H) / 2;
  return {
    points: [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh },
    ],
  };
};

describe('only what is lined up in the green box is decoded', () => {
  it('accepts a barcode centred in the box', () => {
    expect(symbolInRegion(sym(0.5, 0.5), BOX, W, H)).toBe(true);
  });

  it('REJECTS the EAN sitting top-right on the same label (Fribin case)', () => {
    expect(symbolInRegion(sym(0.82, 0.12), BOX, W, H)).toBe(false);
  });

  it('REJECTS a barcode along the bottom of the label', () => {
    expect(symbolInRegion(sym(0.5, 0.92), BOX, W, H)).toBe(false);
  });

  it('accepts a long barcode whose ends overhang the box (centre still inside)', () => {
    // Wider than the box, but lined up — this must still scan.
    expect(symbolInRegion(sym(0.5, 0.5, 1.2), BOX, W, H)).toBe(true);
  });

  it('rejects one just outside the top edge, accepts one just inside', () => {
    expect(symbolInRegion(sym(0.5, 0.34), BOX, W, H)).toBe(false);
    expect(symbolInRegion(sym(0.5, 0.38), BOX, W, H)).toBe(true);
  });

  it('keeps a symbol with no position data (never scan nothing)', () => {
    expect(symbolInRegion({ points: [] }, BOX, W, H)).toBe(true);
  });
});

describe('when a frame yields several barcodes, the GS1 carton one wins', () => {
  const GS1_WEIGHT = '(01)99332218351761(3102)001754(13)260630(21)090000400447';
  const GS1_NO_WEIGHT = '(01)19414735674029(17)260727';
  const EAN = '9300675024235';
  const INTERNAL = '4619700198';

  it('puts a full GS1 weight barcode ahead of an EAN and an internal code', () => {
    expect(orderByGs1Preference([EAN, INTERNAL, GS1_WEIGHT])[0]).toBe(GS1_WEIGHT);
  });

  it('prefers a GS1 GTIN barcode over non-GS1 ones', () => {
    expect(orderByGs1Preference([INTERNAL, GS1_NO_WEIGHT])[0]).toBe(GS1_NO_WEIGHT);
  });

  it('is stable when nothing parses as GS1 (first seen stays first)', () => {
    expect(orderByGs1Preference([EAN, INTERNAL])).toEqual([EAN, INTERNAL]);
  });

  it('keeps every decode — ordering only, never dropping', () => {
    expect(orderByGs1Preference([EAN, GS1_WEIGHT, INTERNAL])).toHaveLength(3);
  });
});
