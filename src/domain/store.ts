import type {
  AcceptanceSnapshot,
  ID,
  ObservationRecord,
  OutboxEntry,
  Sample,
  ScaleVersion,
  ServerState,
  StainBatch,
} from "./types";

/**
 * 统一持久层接口。
 * 内存实现用于逻辑测试；IndexedDB 实现用于浏览器离线补录与断点恢复。
 * 所有多步写操作由 engine 在内存中计算后整体落盘，中断后重启仍可从
 * OutboxEntry.state 与 ObservationRecord.completedStages 恢复。
 */
export interface Store {
  samples: Repo<Sample>;
  stainBatches: Repo<StainBatch>;
  scaleVersions: Repo<ScaleVersion>;
  records: Repo<ObservationRecord>;
  outbox: Repo<OutboxEntry>;
  snapshots: Repo<AcceptanceSnapshot>;
  server: KVRepo<ServerState>;
  meta: KVRepo<string>;
}

export interface Repo<T extends { id: ID }> {
  get(id: ID): Promise<T | undefined>;
  /** upsert：存在则整体覆盖（调用方负责先读后并），不存在则插入 */
  put(item: T): Promise<void>;
  putAll(items: T[]): Promise<void>;
  all(): Promise<T[]>;
  delete(id: ID): Promise<void>;
}

export interface KVRepo<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
}

export function createMemoryStore(initial?: Partial<ServerState>): Store {
  return makeMemoryStore(initial);
}

export function makeMemoryStore(initial?: Partial<ServerState>): Store {
  const tables: Record<string, Map<string, unknown>> = {};
  const repo = <T extends { id: ID }>(name: string): Repo<T> => {
    const table = (tables[name] ??= new Map());
    return {
      async get(id) {
        return table.get(id) as T | undefined;
      },
      async put(item) {
        table.set(item.id, item);
      },
      async putAll(items) {
        for (const item of items) table.set(item.id, item);
      },
      async all() {
        return [...table.values()] as T[];
      },
      async delete(id) {
        table.delete(id);
      },
    };
  };

  const kv = <T>(name: string): KVRepo<T> => {
    const table = (tables[name] ??= new Map());
    return {
      async get(key) {
        return table.get(key) as T | undefined;
      },
      async set(key, value) {
        table.set(key, value);
      },
    };
  };

  const store: Store = {
    samples: repo<Sample>("samples"),
    stainBatches: repo<StainBatch>("stainBatches"),
    scaleVersions: repo<ScaleVersion>("scaleVersions"),
    records: repo<ObservationRecord>("records"),
    outbox: repo<OutboxEntry>("outbox"),
    snapshots: repo<AcceptanceSnapshot>("snapshots"),
    server: kv<ServerState>("server"),
    meta: kv<string>("meta"),
  };

  const server: ServerState = {
    claims: initial?.claims ?? {},
    receipts: initial?.receipts ?? {},
  };
  store.server.set("state", server);
  return store;
}
