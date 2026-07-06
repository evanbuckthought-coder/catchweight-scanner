/**
 * Input rules for the manual-entry weight keypad. Pure so the fast path
 * (every carton on manual suppliers goes through this) is unit-tested.
 */

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

/** Max integer digits — big enough that a fat-fingered "1454" SURFACES via the
 *  1-40 kg guardrail instead of being silently blocked mid-typing. */
const MAX_INT_DIGITS = 4;
/** Catchweight scales print at most 3 decimal places. */
const MAX_DECIMALS = 3;

export function applyKeypadKey(current: string, key: KeypadKey): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === '.') {
    if (current.includes('.')) return current;
    return current === '' ? '0.' : current + '.';
  }
  const dot = current.indexOf('.');
  if (dot !== -1) {
    return current.length - dot - 1 >= MAX_DECIMALS ? current : current + key;
  }
  if (current.length >= MAX_INT_DIGITS) return current;
  if (current === '0') return key; // no leading zeros ("05" -> "5")
  return current + key;
}

/** The typed value as a number, or null while it isn't a usable weight yet. */
export function keypadValue(current: string): number | null {
  if (current === '' || current === '0.' || current === '.') return null;
  const n = Number.parseFloat(current);
  return Number.isFinite(n) && n > 0 ? n : null;
}
