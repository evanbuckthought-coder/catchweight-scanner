/**
 * Durable on-device persistence for sessions (IndexedDB) with forward
 * migrations. Everything stays local — no backend, no cloud.
 *
 * Principles:
 *  - Records carry their own schemaVersion and are migrated ON READ, then
 *    written back. An app update must never destroy data.
 *  - If a record can't be migrated (unknown/newer version, corrupt), it is
 *    PRESERVED as-is and surfaced as unreadable — never deleted silently. Only
 *    the user deletes.
 *  - Legacy localStorage sessions (the pre-IndexedDB keys) are imported once,
 *    migrated, and only then removed from localStorage.
 *
 * Schema history:
 *  v1  flat {receiptRef, expectation, cartons[]}          — NOT migrated (the
 *      product grouping can't be reconstructed faithfully); left untouched in
 *      localStorage under 'cw.currentSession'.
 *  v2  PO -> products -> cartons        (cartons have manual: boolean)
 *  v3  PO -> products -> pallets -> cartons  (manual: boolean)
 *  v4  cartons carry entry: scan|ocr|manual
 *  v5  pallets carry a fixed number (identity, not position)   <- CURRENT
 */

import type { Session } from '../types';
import { uid } from './storage';
import { allCartons, totalKg } from './session';
import { kvDelete, kvGet, kvSet, receivalDelete, receivalPut, receivalsGetAll } from './db';

export const CURRENT_SCHEMA = 5;

const ACTIVE_KEY = 'activeSession';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySession = any;

/** v2 -> v3: wrap each product's flat carton list into a single pallet. */
function m2to3(s: AnySession): AnySession {
  return {
    ...s,
    products: (s.products ?? []).map((p: AnySession) => {
      const { cartons, ...rest } = p;
      return {
        ...rest,
        pallets: [{ id: uid(), palletId: undefined, startedAt: p.startedAt, cartons: cartons ?? [] }],
      };
    }),
    activePalletId: null,
  };
}

/** v3 -> v4: manual boolean -> entry method. */
function m3to4(s: AnySession): AnySession {
  return {
    ...s,
    products: (s.products ?? []).map((p: AnySession) => ({
      ...p,
      pallets: (p.pallets ?? []).map((pl: AnySession) => ({
        ...pl,
        cartons: (pl.cartons ?? []).map((c: AnySession) => {
          const { manual, ...rest } = c;
          return { ...rest, entry: manual ? 'manual' : 'scan' };
        }),
      })),
    })),
  };
}

/** v4 -> v5: assign fixed pallet numbers (positional at migration time). */
function m4to5(s: AnySession): AnySession {
  return {
    ...s,
    products: (s.products ?? []).map((p: AnySession) => ({
      ...p,
      pallets: (p.pallets ?? []).map((pl: AnySession, i: number) => ({ ...pl, number: i + 1 })),
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const MIGRATIONS: Record<number, (s: AnySession) => AnySession> = {
  2: m2to3,
  3: m3to4,
  4: m4to5,
};

/** Minimal shape sanity check after migration. */
function looksLikeSession(s: AnySession): s is Session {
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.poRef === 'string' &&
    Array.isArray(s.products) &&
    s.products.every((p: AnySession) => Array.isArray(p?.pallets))
  );
}

/**
 * Migrate a stored session from `fromVersion` to the current schema. Returns
 * null when migration isn't possible (unknown/newer version, corrupt data) —
 * the caller must PRESERVE the original record in that case.
 */
export function migrateSession(raw: unknown, fromVersion: number): Session | null {
  if (raw == null || typeof raw !== 'object') return null;
  if (fromVersion > CURRENT_SCHEMA) return null; // written by a newer app version
  let s: AnySession = raw;
  try {
    for (let v = fromVersion; v < CURRENT_SCHEMA; v++) {
      const step = MIGRATIONS[v];
      if (!step) return null; // no path forward from this version
      s = step(s);
    }
  } catch {
    return null;
  }
  return looksLikeSession(s) ? (s as Session) : null;
}

interface StoredActive {
  schemaVersion: number;
  session: unknown;
}

/** Completed receival as stored. List fields are denormalised so the history
 *  screen works even if the full session can't be migrated/opened. */
export interface SavedReceival {
  id: string;
  savedAt: string;
  schemaVersion: number;
  poRef: string;
  supplier: string;
  brand?: string;
  totalKg: number;
  cartonCount: number;
  session: unknown;
}

/** Legacy localStorage keys, newest first, with the schema they contained. */
const LEGACY_KEYS: Array<[string, number]> = [
  ['cw.currentSession.v4', 4],
  ['cw.currentSession.v3', 3],
  ['cw.currentSession.v2', 2],
];

function readLegacySession(): { session: Session; key: string } | null {
  for (const [key, version] of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      const parsed = JSON.parse(raw);
      if (parsed == null) continue;
      const migrated = migrateSession(parsed, version);
      if (migrated) return { session: migrated, key };
    } catch {
      /* unreadable legacy entry — leave it in place */
    }
  }
  return null;
}

/**
 * Load the in-progress session: IndexedDB first, else a one-time import of a
 * legacy localStorage session (migrated, moved into IDB, then removed from
 * localStorage — only after the IDB write succeeded).
 */
export async function loadActiveSession(): Promise<Session | null> {
  const stored = await kvGet<StoredActive>(ACTIVE_KEY);
  if (stored) {
    if (stored.schemaVersion === CURRENT_SCHEMA && looksLikeSession(stored.session)) {
      return stored.session as Session;
    }
    const migrated = migrateSession(stored.session, stored.schemaVersion);
    if (migrated) {
      await kvSet(ACTIVE_KEY, { schemaVersion: CURRENT_SCHEMA, session: migrated } satisfies StoredActive);
      return migrated;
    }
    // Can't read it (newer/unknown schema). Preserve under a side key for
    // future recovery rather than deleting, and start fresh.
    console.warn(`Active session has schemaVersion ${stored.schemaVersion}; preserved as unreadable.`);
    await kvSet(`${ACTIVE_KEY}.unreadable.${Date.now()}`, stored);
    await kvDelete(ACTIVE_KEY);
    return null;
  }

  const legacy = readLegacySession();
  if (legacy) {
    await kvSet(ACTIVE_KEY, { schemaVersion: CURRENT_SCHEMA, session: legacy.session } satisfies StoredActive);
    try {
      localStorage.removeItem(legacy.key);
    } catch {
      /* ignore */
    }
    return legacy.session;
  }
  return null;
}

/** Persist (or clear) the in-progress session. Throws on failure so the UI can warn. */
export async function saveActiveSession(session: Session | null): Promise<void> {
  if (session == null) {
    await kvDelete(ACTIVE_KEY);
    return;
  }
  await kvSet(ACTIVE_KEY, { schemaVersion: CURRENT_SCHEMA, session } satisfies StoredActive);
}

/** Save a finished session to history. Returns the stored record. */
export async function saveReceival(session: Session): Promise<SavedReceival> {
  const record: SavedReceival = {
    id: session.id || uid(),
    savedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA,
    poRef: session.poRef,
    supplier: session.supplier,
    brand: session.brand,
    totalKg: totalKg(allCartons(session)),
    cartonCount: allCartons(session).length,
    session,
  };
  await receivalPut(record);
  return record;
}

/** All saved receivals, newest first. */
export async function listReceivals(): Promise<SavedReceival[]> {
  const all = await receivalsGetAll<SavedReceival>();
  return all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

/** Open a saved receival's full session, migrating if it predates the current
 *  schema (migrated copy is written back). Null = unreadable (still listed). */
export async function openReceival(record: SavedReceival): Promise<Session | null> {
  if (record.schemaVersion === CURRENT_SCHEMA && looksLikeSession(record.session)) {
    return record.session as Session;
  }
  const migrated = migrateSession(record.session, record.schemaVersion);
  if (migrated) {
    await receivalPut({ ...record, schemaVersion: CURRENT_SCHEMA, session: migrated });
    return migrated;
  }
  return null;
}

/** Delete a saved receival (user-confirmed in the UI). */
export async function removeReceival(id: string): Promise<void> {
  await receivalDelete(id);
}
