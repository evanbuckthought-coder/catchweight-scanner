/**
 * Tiny typed localStorage layer.
 *
 * Only operational data lives here (scanner name, GTIN profiles, the in-flight
 * session). Nothing sensitive — no credentials, no PII beyond the operator's
 * chosen display name. Everything stays on the device; there is no sync.
 */

export const STORAGE_KEYS = {
  scannedBy: 'cw.scannedBy',
  profiles: 'cw.gtinProfiles',
  session: 'cw.currentSession',
} as const;

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota / private-mode failures shouldn't crash the scan loop.
    console.warn(`Failed to persist "${key}":`, err);
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Stable id helper (crypto.randomUUID with a fallback for old WebViews). */
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
