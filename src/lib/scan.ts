/**
 * Scan router — the single entry point every scan screen uses.
 *
 * Order is a guardrail, not a preference:
 *   1. GS1-128 (the standard) is ALWAYS tried first. A barcode that parses as
 *      valid GS1 can never be claimed or overridden by a custom map.
 *   2. Only if GS1 yields nothing usable do AI-taught format maps get a look,
 *      decoding ON-DEVICE from the scanner's exact digits.
 *   3. Anything else comes back unreadable, so the UI can offer "Analyse
 *      barcode with AI" alongside manual entry.
 */

import { parseGS1, type ParsedCarton } from './gs1';
import {
  decodeWithSavedMaps,
  loadBarcodeMaps,
  type DecodedBarcode,
  type SavedBarcodeMap,
} from './barcodeMaps';

export type ScanResult =
  /** Readable carton — from GS1, or from a custom map (`map` set). */
  | { kind: 'carton'; parsed: ParsedCarton; map?: SavedBarcodeMap; decoded?: DecodedBarcode }
  /** No format could read it — offer AI analysis / manual entry. */
  | { kind: 'unreadable'; raw: string; parsed: ParsedCarton; reason: string }
  /** A saved map claimed it but the decode failed validation — never counted. */
  | { kind: 'refused'; raw: string; reason: string; map: SavedBarcodeMap }
  /** Two saved maps could claim it — do not guess; fall back to manual. */
  | { kind: 'ambiguous'; raw: string; maps: SavedBarcodeMap[] };

/** Build a carton record from an on-device custom decode. */
export function cartonFromDecoded(
  raw: string,
  decoded: DecodedBarcode,
  map: SavedBarcodeMap,
): ParsedCarton {
  return {
    raw,
    format: 'custom',
    formatName: decoded.formatName,
    itemCode: decoded.productCode,
    netWeight: decoded.netWeight,
    weightUnit: decoded.unit,
    weightKg: decoded.weightKg,
    weightAI: 'custom',
    productionDate: decoded.productionDate,
    bestBefore: decoded.bestBefore,
    serial: decoded.serial,
    traceId: decoded.serial,
    traceAI: decoded.serial ? 'custom' : undefined,
    fingerprint: `custom|${map.id}|${decoded.productCode ?? '?'}`,
    elements: [],
    unknownAIs: [],
    errors: [],
    valid: true,
  };
}

export function parseScan(
  raw: string,
  maps: SavedBarcodeMap[] = loadBarcodeMaps(),
  now: number = Date.now(),
): ScanResult {
  const parsed = parseGS1(raw);
  if (parsed.valid) {
    parsed.format = 'gs1';
    return { kind: 'carton', parsed };
  }

  const lookup = decodeWithSavedMaps(raw.trim(), maps, now);
  switch (lookup.kind) {
    case 'decoded':
      return {
        kind: 'carton',
        parsed: cartonFromDecoded(raw, lookup.decoded, lookup.map),
        map: lookup.map,
        decoded: lookup.decoded,
      };
    case 'invalid':
      return { kind: 'refused', raw, reason: lookup.reason, map: lookup.map };
    case 'ambiguous':
      return { kind: 'ambiguous', raw, maps: lookup.maps };
    case 'none':
    default:
      return {
        kind: 'unreadable',
        raw,
        parsed,
        reason: parsed.errors[0] ?? 'Barcode not recognised',
      };
  }
}
