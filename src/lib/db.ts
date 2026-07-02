/**
 * Minimal promise wrapper over IndexedDB. No dependencies, no backend.
 *
 * Why IndexedDB (not localStorage) for session data: far larger quota, more
 * robust eviction behaviour, and it survives app updates — a deploy never
 * touches it. Two stores:
 *   - kv:         small keyed blobs (the in-progress session lives here)
 *   - receivals:  completed sessions, keyPath 'id'
 *
 * The DB *structure* version below is independent of the app-level data schema
 * version (see persistence.ts) — records carry their own schemaVersion and are
 * migrated on read, so a data-shape change never requires an IDB upgrade or a
 * destructive wipe.
 */

const DB_NAME = 'catchweight-scanner';
const DB_VERSION = 1;
export const KV_STORE = 'kv';
export const RECEIVALS_STORE = 'receivals';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
        if (!db.objectStoreNames.contains(RECEIVALS_STORE)) {
          db.createObjectStore(RECEIVALS_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    });
    // A failed open must not poison future retries.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    requestToPromise(req).then(resolve, reject);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

export function kvGet<T>(key: string): Promise<T | undefined> {
  return withStore<T | undefined>(KV_STORE, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await withStore(KV_STORE, 'readwrite', (s) => s.put(value, key));
}

export async function kvDelete(key: string): Promise<void> {
  await withStore(KV_STORE, 'readwrite', (s) => s.delete(key));
}

export function receivalsGetAll<T>(): Promise<T[]> {
  return withStore<T[]>(RECEIVALS_STORE, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export function receivalGet<T>(id: string): Promise<T | undefined> {
  return withStore<T | undefined>(RECEIVALS_STORE, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
}

export async function receivalPut<T extends { id: string }>(record: T): Promise<void> {
  await withStore(RECEIVALS_STORE, 'readwrite', (s) => s.put(record));
}

export async function receivalDelete(id: string): Promise<void> {
  await withStore(RECEIVALS_STORE, 'readwrite', (s) => s.delete(id));
}
