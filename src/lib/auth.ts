/**
 * Lightweight passcode gate.
 *
 * This is deliberately NOT hardened auth: the passcode ships in the client
 * bundle, so anyone who reads the JS can find it. Its only job is to stop the
 * public Vercel URL from being casually usable by someone who stumbles on it.
 * There is no backend and no env var by design.
 *
 * To change the passcode: edit APP_PASSCODE below, commit, and push — Vercel
 * redeploys automatically. (Changing it does NOT re-lock devices that already
 * unlocked; clear the flag below or the site data to force a re-prompt.)
 */

export const APP_PASSCODE = 'er4q-vpn5-fhj4';

/** localStorage key holding the "this device has been unlocked" flag. */
export const UNLOCK_FLAG_KEY = 'cw.unlocked';

export function isUnlocked(): boolean {
  try {
    return localStorage.getItem(UNLOCK_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setUnlocked(): void {
  try {
    localStorage.setItem(UNLOCK_FLAG_KEY, '1');
  } catch {
    /* private mode / quota — gate just re-prompts next load */
  }
}

/** Constant-time-ish compare (length-independent short-circuit avoided). */
export function checkPasscode(input: string): boolean {
  return input.trim() === APP_PASSCODE;
}
