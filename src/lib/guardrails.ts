/**
 * Weight sanity-check guardrails.
 *
 * These are confirmation prompts, never silent rejections: they force a human
 * glance on anything that looks like a misread/typo, but the user can always
 * override after checking the printed label. Checks run on the final kg value,
 * after any lb->kg conversion.
 */

import { roundKg } from './units';

/** Valid carton weight range (kg), inclusive. */
export const MIN_CARTON_KG = 1;
export const MAX_CARTON_KG = 40;

export interface WeightCheckInput {
  /** Final weight in kg (after lb->kg conversion). */
  weightKg: number;
  /** The captured value in its original unit (used for the decimal-shape check). */
  netWeight: number;
  /**
   * True for a scanned/OCR capture (applies the missed-decimal check too).
   * Manual entries pass false — they only get the range check.
   */
  isScan: boolean;
}

/**
 * Return human-readable warnings for a captured weight. Empty array = looks
 * fine. A non-empty result means the UI must make the user confirm or re-enter.
 */
export function weightWarnings({ weightKg, netWeight, isScan }: WeightCheckInput): string[] {
  const warnings: string[] = [];

  // 1. Outside the normal carton range.
  if (weightKg < MIN_CARTON_KG || weightKg > MAX_CARTON_KG) {
    warnings.push(
      `Weight ${roundKg(weightKg).toFixed(2)} kg is outside the normal carton range (${MIN_CARTON_KG}–${MAX_CARTON_KG} kg). Confirm or re-enter.`,
    );
  }

  // 2. (Scan only) No decimal in the captured value — likely a missed-decimal
  //    misread (e.g. "186" instead of "18.6"). A genuinely round weight is still
  //    enterable after the user confirms.
  if (isScan && Number.isFinite(netWeight) && Number.isInteger(netWeight)) {
    warnings.push('No decimal point detected — please confirm the weight against the label.');
  }

  return warnings;
}
