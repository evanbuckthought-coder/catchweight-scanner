/**
 * Unit handling for catchweight (random-weight) cartons.
 *
 * GS1 weight AIs come in two flavours we care about:
 *   - 310n -> net weight in kilograms
 *   - 320n -> net weight in pounds
 * We always normalise to kg so the running pallet total is a single number,
 * regardless of how individual cartons were labelled.
 */

/** Exact international avoirdupois pound -> kilogram factor. */
export const LB_TO_KG = 0.45359237;

export type WeightUnit = 'kg' | 'lb';

/** Convert a value in the given unit to kilograms. */
export function toKg(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? value * LB_TO_KG : value;
}

/**
 * Round a kg value to a sensible precision for display/summation.
 * Catchweight scales report to 0.001 kg at most; we keep 3 dp to avoid
 * floating-point dust accumulating across a pallet of cartons.
 */
export function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000;
}
