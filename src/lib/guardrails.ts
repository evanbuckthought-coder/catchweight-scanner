/**
 * Weight sanity-check guardrails.
 *
 * These are confirmation prompts, never silent rejections: they force a human
 * glance on anything that looks like a misread/typo, but the user can always
 * override after checking the printed label. Checks run on the final kg value,
 * after any lb->kg conversion.
 *
 * Which checks apply where:
 *  - Range (1-40 kg): every capture path — barcode scan, OCR read, manual key.
 *  - Missed-decimal: OCR reads only (requireDecimal: true). Barcode weights are
 *    exactly encoded (310n/320n decimal digit) and manual typos are covered by
 *    the range check, so neither needs it.
 */

import { roundKg } from './units';

/** Valid carton weight range (kg), inclusive. */
export const MIN_CARTON_KG = 1;
export const MAX_CARTON_KG = 40;

export interface WeightCheckInput {
  /** Final weight in kg (after lb->kg conversion). */
  weightKg: number;
  /** Whether the captured value carried a decimal point. Default true. */
  hasDecimal?: boolean;
  /** Apply the missed-decimal check (OCR reads). Default false. */
  requireDecimal?: boolean;
}

/**
 * Return human-readable warnings for a captured weight. Empty array = clean
 * read, auto-acceptable. Non-empty = the UI must make the user confirm or
 * re-capture before it enters the tally.
 */
export function weightWarnings({
  weightKg,
  hasDecimal = true,
  requireDecimal = false,
}: WeightCheckInput): string[] {
  const warnings: string[] = [];

  if (weightKg < MIN_CARTON_KG || weightKg > MAX_CARTON_KG) {
    warnings.push(
      `Weight ${roundKg(weightKg).toFixed(2)} kg is outside the normal carton range (${MIN_CARTON_KG}–${MAX_CARTON_KG} kg). Confirm or re-enter.`,
    );
  }

  // Catchweight values essentially always carry a decimal (e.g. 18.64). An OCR
  // read without one ("186") is likely a missed decimal point. A genuinely
  // round weight is still enterable — after the user confirms.
  if (requireDecimal && !hasDecimal) {
    warnings.push('No decimal point detected — please confirm the weight against the label.');
  }

  return warnings;
}
