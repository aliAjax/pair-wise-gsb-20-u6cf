import { useCallback, useEffect, useState } from "react";
import {
  buildAcceptanceSnapshot,
  createCentralClient,
  createObservation,
  createSample,
  processOutbox,
  queueForSync,
  recomputeMeasurements,
  recheckRecord,
  recordStaleness,
  releaseClaim,
  updateScaleVersion,
  updateStainBatch,
  upsertReceipt,
  type SyncReport,
} from "../domain/engine";
import type { Store } from "../domain/store";
import type {
  AcceptanceSnapshot,
  ObservationRecord,
  OutboxEntry,
  Sample,
  ScaleVersion,
  ServerState,
  StainBatch,
} from "../domain/types";
import { idbStore, resetDatabase } from "./idb";
import { seedDemo } from "./seed";

export interface Workspace {
  samples: Sample[];
  stains: StainBatch[];
  scales: ScaleVersion[];
  records: ObservationRecord[];
  outbox: OutboxEntry[];
  snapshots: AcceptanceSnapshot[];
  server: ServerState;
}

const empty: Workspace = {
  samples: [],
  stains: [],
  scales: [],
  records: [],
  outbox: [],
  snapshots: [],
  server: { claims: {}, receipts: {} },
};

async function readWorkspace(store: Store): Promise<Workspace> {
  const [samples, stains, scales, records, outbox, snapshots, server] = await Promise.all([
    store.samples.all(),
    store.stainBatches.all(),
    store.scaleVersions.all(),
    store.records.all(),
    store.outbox.all(),
    store.snapshots.all(),
    store.server.get("state"),
  ]);
  const byCreated = (a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt;
  return {
    samples: samples.sort((a, b) => a.collectedAt - b.collectedAt),
    stains: stains.sort(byCreated),
    scales: scales.sort(byCreated),
    records: records.sort(byCreated),
    outbox: outbox.sort(byCreated),
    snapshots: snapshots.sort((a, b) => b.createdAt - a.createdAt),
    server: server ?? { claims: {}, receipts: {} },
  };
}

/** 计算记录的派生视图：依赖是否失效、待核原因等 */
export function deriveRecordView(
  record: ObservationRecord,
  ws: Pick<Workspace, "stains" | "scales">,
) {
  const stain = ws.stains.find((s) => s.id === record.stainBatchId);
  const scale = ws.scales.find((s) => s.id === record.scaleVersionId);
  const staleness = recordStaleness(record, stain, scale);
  return { stain, scale, staleness };
}

export function useAcceptance() {
  const [store, setStore] = useState<Store>();
  const [ws, setWs] = useState<Workspace>(empty);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string>();

  const refresh = useCallback(async () => {
    if (!store) return;
    setWs(await readWorkspace(store));
  }, [store]);

  useEffect(() => {
    let mounted = true;
    const s = idbStore();
    seedDemo(s)
      .then(() => readWorkspace(s))
      .then((data) => {
        if (mounted) {
          setStore(s);
          setWs(data);
        }
      });
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      mounted = false;
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const run = useCallback(
    async (action: string, fn: (s: Store) => Promise<void | string>) => {
      if (!store) return;
      setBusy(true);
      try {
        const message = await fn(store);
        await refresh();
        setToast(message ?? `${action}完成`);
      } catch (err) {
        setToast(`${action}失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [store, refresh],
  );

  const actions = {
    queue: (id: string) => run("加入发送队列", (s) => queueForSync(s, id).then(() => undefined)),
    sync: () =>
      run("回网核对", async (s) => {
        if (!navigator.onLine) {
          return "当前处于离线模式，发送队列已保留；恢复网络后再核对，已完成的写入阶段不会重复执行";
        }
        const report: SyncReport = await processOutbox(s, createCentralClient(s));
        return `核对完成：验收 ${report.accepted} 条，待核 ${report.blocked} 条，等待回执 ${report.waitingReceipt} 条${
          report.failed ? `，网络失败 ${report.failed} 条（已保留进度，可重试）` : ""
        }`;
      }),
    recheck: (id: string) =>
      run("重新核对", (s) => recheckRecord(s, createCentralClient(s), id).then(() => undefined)),
    recompute: (id: string) =>
      run("重算测量结论", (s) => recomputeMeasurements(s, id).then(() => undefined)),
    bumpStain: (id: string) =>
      run("染色批次更新", (s) => updateStainBatch(s, id, { note: "已重新标定" }).then(() => undefined)),
    bumpScale: (id: string) =>
      run("标尺重新标定", async (s) => {
        const scale = await s.scaleVersions.get(id);
        if (!scale) throw new Error("标尺不存在");
        const next = Math.max(0.01, Math.round(scale.umPerPixel * 1.1 * 1000) / 1000);
        await updateScaleVersion(s, id, { umPerPixel: next });
      }),
    snapshot: () =>
      run("生成已验收快照", async (s) => {
        const result = await buildAcceptanceSnapshot(s, "实验管理员");
        return `快照 ${result.snapshot.id.slice(-6)} 已生成：收录 ${result.included} 条${
          result.skipped.length ? `，跳过失效未重算 ${result.skipped.length} 条` : ""
        }`;
      }),
    registerAndObserve: (input: Parameters<typeof createSample>[1] & {
      microscopist: string;
      magnification: string;
      structures: string;
      description: string;
      scaleVersionId: string;
      measurements: { feature: string; pixels: number }[];
      queueNow: boolean;
    }) =>
      run("离线补录", async (s) => {
        const sample = await createSample(s, input);
        const record = await createObservation(s, {
          sampleId: sample.id,
          microscopist: input.microscopist,
          magnification: input.magnification,
          structures: input.structures,
          description: input.description,
          scaleVersionId: input.scaleVersionId,
          measurements: input.measurements,
        });
        if (input.queueNow) await queueForSync(s, record.id);
        return input.queueNow
          ? `玻片 ${sample.slideNo} 已补录入队，等待回网核对`
          : `玻片 ${sample.slideNo} 已离线保存为草稿`;
      }),
    resetDemo: () =>
      run("重置演示数据", async () => {
        await resetDatabase();
        const fresh = idbStore();
        await seedDemo(fresh);
        setStore(fresh);
      }),
    upsertReceipt: (receipt: import("../domain/types").CentralReceipt) =>
      run("登记中心回执", async (s) => {
        await upsertReceipt(s, receipt);
      }),
    releaseClaim: (slideNo: string) =>
      run("释放编号占用", (s) => releaseClaim(s, slideNo).then(() => undefined)),
    injectFault: (slideNo: string, stage: "claim" | "receipt") =>
      run("注入写入中断", async (s) => {
        const client = createCentralClient(s) as unknown as {
          failOnce: (sl: string, st: "claim" | "receipt") => void;
        };
        client.failOnce(slideNo, stage);
        return `已安排 ${slideNo} 的 ${stage === "claim" ? "编号仲裁" : "回执核对"} 阶段下一次网络中断（仅一次）`;
      }),
  };

  return { ws, online, busy, toast, setToast, actions };
}
