import type { KVRepo, Repo, Store } from "../domain/store";
import type {
  AcceptanceSnapshot,
  ID,
  ObservationRecord,
  OutboxEntry,
  Sample,
  ScaleVersion,
  ServerState,
  StainBatch,
} from "../domain/types";

const DB_NAME = "slide-acceptance";
const DB_VERSION = 1;

const STORES = [
  "samples",
  "stainBatches",
  "scaleVersions",
  "records",
  "outbox",
  "snapshots",
  "serverKV",
  "metaKV",
] as const;

type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 仅供重置演示数据使用；会清空全部本地库并重新打开 */
export async function resetDatabase(): Promise<void> {
  const db = await openDb();
  db.close();
  dbPromise = undefined;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(name, mode);
        const req = run(transaction.objectStore(name));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbRepo<T extends { id: ID }>(name: StoreName): Repo<T> {
  return {
    get: (id) => tx(name, "readonly", (s) => s.get(id) as IDBRequest<T | undefined>),
    put: (item) => tx(name, "readwrite", (s) => s.put(item, item.id) as IDBRequest<ID>).then(() => undefined),
    putAll: async (items) => {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(name, "readwrite");
        const objectStore = transaction.objectStore(name);
        for (const item of items) objectStore.put(item, item.id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },
    all: () =>
      tx(name, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
    delete: (id) => tx(name, "readwrite", (s) => s.delete(id) as IDBRequest<undefined>).then(() => undefined),
  };
}

function idbKV<T>(name: StoreName): KVRepo<T> {
  return {
    get: (key) => tx(name, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
    set: (key, value) =>
      tx(name, "readwrite", (s) => s.put(value, key) as IDBRequest<IDBValidKey>).then(() => undefined),
  };
}

let cache: Store | undefined;

export function idbStore(): Store {
  if (cache) return cache;
  cache = {
    samples: idbRepo<Sample>("samples"),
    stainBatches: idbRepo<StainBatch>("stainBatches"),
    scaleVersions: idbRepo<ScaleVersion>("scaleVersions"),
    records: idbRepo<ObservationRecord>("records"),
    outbox: idbRepo<OutboxEntry>("outbox"),
    snapshots: idbRepo<AcceptanceSnapshot>("snapshots"),
    server: idbKV<ServerState>("serverKV"),
    meta: idbKV<string>("metaKV"),
  };
  return cache;
}
