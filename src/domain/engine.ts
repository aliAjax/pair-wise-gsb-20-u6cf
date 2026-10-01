import { LocalCentralClient, type CentralClient } from "./central";
import type { Store } from "./store";
import type {
  AcceptanceSnapshot,
  BlockedReason,
  CentralReceipt,
  ID,
  Measurement,
  ObservationRecord,
  OutboxEntry,
  Sample,
  ScaleVersion,
  ServerState,
  StainBatch,
} from "./types";

let seq = 0;
export function uid(prefix: string): ID {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export const clock = { now: () => Date.now() };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** 样本核对指纹：与中心回执回传值必须一致 */
export function sampleFingerprint(s: {
  stainBatchCode: string;
  specimenType: string;
  collectedAt: number;
}): string {
  const day = new Date(s.collectedAt).toISOString().slice(0, 10);
  return [s.stainBatchCode, s.specimenType, day].join("|");
}

// ---------- 染色批次 / 标尺版本（版本化依赖） ----------

export async function createStainBatch(
  store: Store,
  input: { code: string; method: string; note?: string },
): Promise<StainBatch> {
  const existing = (await store.stainBatches.all()).find((b) => b.code === input.code);
  if (existing) throw new Error(`染色批次编号已存在：${input.code}`);
  const now = clock.now();
  const batch: StainBatch = {
    id: uid("stain"),
    code: input.code,
    method: input.method,
    version: 1,
    active: true,
    createdAt: now,
    updatedAt: now,
    note: input.note,
  };
  await store.stainBatches.put(batch);
  return batch;
}

/**
 * 批次信息更新（如重新标定/补发试剂说明）：version+1。
 * 批次编码 code 保持不变——它是与中心对账的身份，版本号只影响本地测量结论有效性。
 */
export async function updateStainBatch(
  store: Store,
  id: ID,
  patch: { method?: string; note?: string; active?: boolean },
): Promise<StainBatch> {
  const batch = await store.stainBatches.get(id);
  if (!batch) throw new Error("染色批次不存在");
  const next: StainBatch = {
    ...batch,
    method: patch.method ?? batch.method,
    note: patch.note ?? batch.note,
    active: patch.active ?? batch.active,
    version: batch.version + 1,
    updatedAt: clock.now(),
  };
  await store.stainBatches.put(next);
  return next;
}

export async function createScaleVersion(
  store: Store,
  input: { scope: string; umPerPixel: number; note?: string },
): Promise<ScaleVersion> {
  const now = clock.now();
  const scale: ScaleVersion = {
    id: uid("scale"),
    scope: input.scope,
    umPerPixel: input.umPerPixel,
    version: 1,
    active: true,
    createdAt: now,
    updatedAt: now,
    note: input.note,
  };
  await store.scaleVersions.put(scale);
  return scale;
}

/** 标尺重新标定：version+1，所有引用旧版本的测量结论立即失效 */
export async function updateScaleVersion(
  store: Store,
  id: ID,
  patch: { umPerPixel?: number; note?: string; active?: boolean },
): Promise<ScaleVersion> {
  const scale = await store.scaleVersions.get(id);
  if (!scale) throw new Error("标尺版本不存在");
  const next: ScaleVersion = {
    ...scale,
    umPerPixel: patch.umPerPixel ?? scale.umPerPixel,
    note: patch.note ?? scale.note,
    active: patch.active ?? scale.active,
    version: scale.version + 1,
    updatedAt: clock.now(),
  };
  await store.scaleVersions.put(next);
  return next;
}

// ---------- 样本与观察记录 ----------

export async function createSample(
  store: Store,
  input: {
    slideNo: string;
    name: string;
    specimenType: string;
    stainBatchId: ID;
    collector: string;
    collectedAt: number;
  },
): Promise<Sample> {
  const slideNo = input.slideNo.trim();
  if (!slideNo) throw new Error("玻片编号不能为空");
  const dup = (await store.samples.all()).find((s) => s.slideNo === slideNo);
  if (dup) throw new Error(`玻片编号 ${slideNo} 已登记给样本「${dup.name}」`);
  const stain = await store.stainBatches.get(input.stainBatchId);
  if (!stain) throw new Error("染色批次不存在");
  const sample: Sample = {
    id: uid("smp"),
    slideNo,
    name: input.name.trim(),
    specimenType: input.specimenType.trim(),
    stainBatchId: input.stainBatchId,
    collector: input.collector.trim(),
    collectedAt: input.collectedAt,
    fingerprint: sampleFingerprint({
      stainBatchCode: stain.code,
      specimenType: input.specimenType.trim(),
      collectedAt: input.collectedAt,
    }),
  };
  await store.samples.put(sample);
  return sample;
}

export interface MeasurementInput {
  feature: string;
  pixels: number;
}

export async function createObservation(
  store: Store,
  input: {
    sampleId: ID;
    microscopist: string;
    magnification: string;
    structures: string;
    description: string;
    scaleVersionId: ID;
    measurements: MeasurementInput[];
  },
): Promise<ObservationRecord> {
  const sample = await store.samples.get(input.sampleId);
  if (!sample) throw new Error("样本不存在");
  const stain = await store.stainBatches.get(sample.stainBatchId);
  const scale = await store.scaleVersions.get(input.scaleVersionId);
  if (!stain) throw new Error("染色批次不存在");
  if (!scale) throw new Error("标尺版本不存在");

  const measurements: Measurement[] = input.measurements
    .filter((m) => m.feature.trim() && Number.isFinite(m.pixels) && m.pixels > 0)
    .map((m) => ({
      id: uid("msr"),
      feature: m.feature.trim(),
      pixels: m.pixels,
      um: round3(m.pixels * scale.umPerPixel),
      scaleVersionId: scale.id,
      scaleVersionAtMeasure: scale.version,
    }));

  const now = clock.now();
  const record: ObservationRecord = {
    id: uid("obs"),
    sampleId: sample.id,
    slideNo: sample.slideNo,
    microscopist: input.microscopist.trim(),
    magnification: input.magnification,
    structures: input.structures.trim(),
    description: input.description.trim(),
    stainBatchId: stain.id,
    stainVersionAtMeasure: stain.version,
    scaleVersionId: scale.id,
    measurements,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    completedStages: [],
  };
  await store.records.put(record);
  return record;
}

/** 离线补录完成后入发送队列；回网后由 processOutbox 统一发送 */
export async function queueForSync(store: Store, recordId: ID): Promise<OutboxEntry> {
  const record = await store.records.get(recordId);
  if (!record) throw new Error("观察记录不存在");
  if (record.status !== "draft" && record.status !== "in_review") {
    throw new Error(`当前状态 ${record.status} 不能加入发送队列`);
  }
  const existing = (await store.outbox.all()).find(
    (e) => e.recordId === recordId && e.state !== "done" && e.state !== "conflict",
  );
  const now = clock.now();
  record.status = "queued";
  record.updatedAt = now;
  await store.records.put(record);
  if (existing) return existing;

  const entry: OutboxEntry = {
    id: uid("obx"),
    recordId,
    slideNo: record.slideNo,
    microscopist: record.microscopist,
    createdAt: now,
    attempts: 0,
    state: "pending",
  };
  await store.outbox.put(entry);
  return entry;
}

// ---------- 测量结论有效性 ----------

export interface Staleness {
  stale: boolean;
  reasons: string[];
}

/** 依赖检查：染色批次版本或标尺版本变化即失效，等待重算 */
export function recordStaleness(
  record: ObservationRecord,
  stain: StainBatch | undefined,
  scale: ScaleVersion | undefined,
): Staleness {
  const reasons: string[] = [];
  if (!stain) reasons.push("染色批次已缺失");
  else if (stain.version !== record.stainVersionAtMeasure)
    reasons.push(
      `染色批次 ${stain.code} 已更新（观察时 v${record.stainVersionAtMeasure} → 当前 v${stain.version}）`,
    );
  if (!scale) reasons.push("标尺版本已缺失");
  else if (record.measurements.some((m) => m.scaleVersionAtMeasure !== scale.version))
    reasons.push(
      `标尺 ${scale.scope} 已重新标定（观察时 v${record.measurements[0]?.scaleVersionAtMeasure ?? "?"} → 当前 v${scale.version}）`,
    );
  return { stale: reasons.length > 0, reasons };
}

/** 重算：按当前标尺重新换算测量值，并重新绑定当前染色批次版本 */
export async function recomputeMeasurements(
  store: Store,
  recordId: ID,
): Promise<ObservationRecord> {
  const record = await store.records.get(recordId);
  if (!record) throw new Error("观察记录不存在");
  const stain = await store.stainBatches.get(record.stainBatchId);
  const scale = await store.scaleVersions.get(record.scaleVersionId);
  if (!stain) throw new Error("染色批次已缺失，无法重算");
  if (!scale) throw new Error("标尺版本已缺失，无法重算");

  record.measurements = record.measurements.map((m) => ({
    ...m,
    um: round3(m.pixels * scale.umPerPixel),
    scaleVersionId: scale.id,
    scaleVersionAtMeasure: scale.version,
  }));
  record.stainVersionAtMeasure = stain.version;
  record.updatedAt = clock.now();
  await store.records.put(record);
  return record;
}

// ---------- 回网同步：占用仲裁 + 回执核对（分阶段、可续传） ----------

async function loadServer(store: Store): Promise<ServerState> {
  return (await store.server.get("state")) ?? { claims: {}, receipts: {} };
}

async function saveServer(store: Store, state: ServerState) {
  await store.server.set("state", state);
}

const clientCache = new WeakMap<Store, CentralClient>();

export function createCentralClient(store: Store): CentralClient {
  let client = clientCache.get(store);
  if (!client) {
    client = new LocalCentralClient(
      () => loadServer(store),
      (state) => saveServer(store, state),
    );
    clientCache.set(store, client);
  }
  return client;
}

function block(record: ObservationRecord, reason: BlockedReason) {
  record.status = "in_review";
  record.blockedReason = reason;
  record.updatedAt = clock.now();
}

function receiptDiffs(
  sample: Sample,
  stain: StainBatch,
  receipt: CentralReceipt,
): BlockedReason["diffs"] {
  const diffs: BlockedReason["diffs"] = [];
  const localFp = sample.fingerprint;
  if (localFp !== receipt.sampleFingerprint)
    diffs.push({ field: "样本指纹", local: localFp, remote: receipt.sampleFingerprint });
  if (stain.code !== receipt.stainBatchCode)
    diffs.push({ field: "染色批次", local: stain.code, remote: receipt.stainBatchCode });
  return diffs;
}

export interface SyncReport {
  processed: number;
  accepted: number;
  blocked: number;
  waitingReceipt: number;
  failed: number;
  errors: string[];
}

/**
 * 处理发送队列。
 *
 * 每条记录拆成 claim（编号占用仲裁）与 receipt（回执核对）两个阶段：
 * - 任一阶段成功完成立即写盘，中断重试时 completedStages 里已有的阶段不再执行；
 * - 队列中 state=done 的条目直接跳过，只重试未完成部分；
 * - 网络类故障只影响当前条目，其余条目继续；
 * - 业务终态（占用/拒收/对不上）进待核区，不会被自动重试覆盖。
 */
export async function processOutbox(
  store: Store,
  client: CentralClient,
): Promise<SyncReport> {
  const report: SyncReport = {
    processed: 0,
    accepted: 0,
    blocked: 0,
    waitingReceipt: 0,
    failed: 0,
    errors: [],
  };
  const entries = (await store.outbox.all())
    .filter((e) => e.state !== "done" && e.state !== "conflict")
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const entry of entries) {
    try {
      await syncOne(store, client, entry, report);
    } catch (err) {
      report.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      report.errors.push(`${entry.slideNo}：${msg}`);
      entry.state = "pending"; // 保留在队列，下次回网只重试未完成阶段
      entry.lastError = msg;
      await store.outbox.put(entry);
    }
  }
  return report;
}

async function syncOne(
  store: Store,
  client: CentralClient,
  entry: OutboxEntry,
  report: SyncReport,
) {
  const record = await store.records.get(entry.recordId);
  if (!record) {
    entry.state = "error";
    entry.lastError = "观察记录已被删除";
    await store.outbox.put(entry);
    return;
  }
  report.processed += 1;

  // —— 阶段 1：编号占用仲裁（两名镜检员同编号只放行一条） ——
  if (!record.completedStages.includes("claim")) {
    entry.state = "in_flight";
    entry.attempts += 1;
    await store.outbox.put(entry);

    const res = await client.claimSlide({
      slideNo: record.slideNo,
      recordId: record.id,
      microscopist: record.microscopist,
    });
    if (!res.ok) {
      block(record, {
        kind: "slide_occupied",
        detail: `玻片编号 ${record.slideNo} 已被另一条提交占用，中心只放行一条`,
        receiptId: undefined,
        diffs: [
          { field: "玻片编号", local: record.slideNo, remote: res.conflict.slideNo },
          { field: "占有记录", local: record.id, remote: res.conflict.recordId },
          { field: "镜检员", local: record.microscopist, remote: res.conflict.microscopist },
        ],
      });
      record.submittedBy = record.microscopist;
      entry.state = "conflict";
      entry.lastError = "编号已被其他玻片记录占用";
      await Promise.all([store.records.put(record), store.outbox.put(entry)]);
      report.blocked += 1;
      return;
    }
    record.completedStages.push("claim");
    record.status = "submitted";
    record.submittedAt = res.claim.claimedAt;
    record.submittedBy = record.microscopist;
    // 已完成的阶段立即落盘——此后中断不会重复 claim
    await Promise.all([store.records.put(record), store.outbox.put(entry)]);
  }

  // —— 阶段 2：按玻片编号核对中心回执 ——
  if (!record.completedStages.includes("receipt")) {
    entry.state = "in_flight";
    entry.attempts += 1;
    await store.outbox.put(entry);

    const receipt = await client.fetchReceipt(record.slideNo);
    if (!receipt) {
      entry.state = "pending";
      entry.lastError = "中心回执尚未生成，等待下次回网核对";
      await store.outbox.put(entry);
      report.waitingReceipt += 1;
      return;
    }

    const sample = await store.samples.get(record.sampleId);
    const stain = await store.stainBatches.get(record.stainBatchId);
    record.receiptId = receipt.id;
    record.receiptMatchedAt = clock.now();
    record.completedStages.push("receipt");

    if (!receipt.accepted) {
      block(record, {
        kind: "receipt_rejected",
        receiptId: receipt.id,
        detail: `中心回执 ${receipt.id} 拒收${receipt.note ? `：${receipt.note}` : ""}`,
        diffs: [
          { field: "中心接收结论", local: "待验收", remote: "拒收" },
          { field: "回执编号", local: "（无）", remote: receipt.id },
        ],
      });
      report.blocked += 1;
    } else if (sample && stain) {
      const diffs = receiptDiffs(sample, stain, receipt);
      if (diffs.length > 0) {
        block(record, {
          kind: diffs.some((d) => d.field === "染色批次")
            ? "stain_mismatch"
            : "fingerprint_mismatch",
          receiptId: receipt.id,
          detail: `回执 ${receipt.id} 已接收，但双方核对值不一致`,
          diffs,
        });
        report.blocked += 1;
      } else {
        record.status = "accepted";
        record.blockedReason = undefined;
        record.acceptedAt = clock.now();
        report.accepted += 1;
      }
    } else {
      block(record, {
        kind: "fingerprint_mismatch",
        receiptId: receipt.id,
        detail: "本地样本或染色批次资料缺失，无法完成核对",
        diffs: [{ field: "本地资料", local: "缺失", remote: receipt.id }],
      });
      report.blocked += 1;
    }
    entry.state = "done";
    entry.lastError = undefined;
    await Promise.all([store.records.put(record), store.outbox.put(entry)]);
  }
}

/**
 * 待核区记录在中心侧修正（仲裁释放/回执补正/拒收更正）后重新核对。
 * 两个阶段都重跑：claim 对自有占用幂等放行；若编号仍被他人占用会再次停入待核区。
 */
export async function recheckRecord(store: Store, client: CentralClient, recordId: ID) {
  const record = await store.records.get(recordId);
  if (!record) throw new Error("观察记录不存在");
  if (record.status !== "in_review") throw new Error("只有待核区记录可以重新核对");
  record.blockedReason = undefined;
  record.completedStages = [];
  record.receiptId = undefined;
  record.receiptMatchedAt = undefined;
  record.status = "queued";
  record.updatedAt = clock.now();
  const entry: OutboxEntry = {
    id: uid("obx"),
    recordId,
    slideNo: record.slideNo,
    microscopist: record.microscopist,
    createdAt: clock.now(),
    attempts: 0,
    state: "pending",
  };
  await Promise.all([store.records.put(record), store.outbox.put(entry)]);
  return processOutbox(store, client);
}

// ---------- 已验收快照 ----------

export interface SnapshotResult {
  snapshot: AcceptanceSnapshot;
  included: number;
  skipped: { slideNo: string; reasons: string[] }[];
}

/**
 * 生成已验收快照：测量结论失效（染色/标尺版本过期、未重算）的记录不得进入。
 * 快照一经写入不可变（只新增，不回改）。
 */
export async function buildAcceptanceSnapshot(
  store: Store,
  createdBy: string,
  note?: string,
): Promise<SnapshotResult> {
  const [records, stains, scales] = await Promise.all([
    store.records.all(),
    store.stainBatches.all(),
    store.scaleVersions.all(),
  ]);
  const stainById = new Map(stains.map((s) => [s.id, s]));
  const scaleById = new Map(scales.map((s) => [s.id, s]));

  const skipped: SnapshotResult["skipped"] = [];
  const items: AcceptanceSnapshot["items"] = [];
  const samples = await store.samples.all();
  const sampleNameById = new Map(samples.map((s) => [s.id, s.name]));
  for (const record of records.filter((r) => r.status === "accepted")) {
    const stain = stainById.get(record.stainBatchId);
    const scale = scaleById.get(record.scaleVersionId);
    const staleness = recordStaleness(record, stain, scale);
    if (staleness.stale || !stain || !scale) {
      skipped.push({ slideNo: record.slideNo, reasons: staleness.reasons });
      continue;
    }
    items.push({
      recordId: record.id,
      slideNo: record.slideNo,
      sampleName: sampleNameById.get(record.sampleId) ?? "（样本已删）",
      microscopist: record.microscopist,
      stainBatchCode: stain.code,
      stainVersion: record.stainVersionAtMeasure,
      scaleVersion: record.measurements[0]?.scaleVersionAtMeasure ?? scale.version,
      receiptId: record.receiptId ?? "",
      measurements: record.measurements.map((m) => ({ feature: m.feature, um: m.um })),
    });
  }

  const snapshot: AcceptanceSnapshot = {
    id: uid("snp"),
    createdAt: clock.now(),
    createdBy,
    items,
    note,
  };
  await store.snapshots.put(snapshot);
  return { snapshot, included: items.length, skipped };
}

// ---------- 中心实验室侧（回执台/仲裁，演示与联调用） ----------

export async function upsertReceipt(store: Store, receipt: CentralReceipt) {
  const state = await loadServer(store);
  state.receipts[receipt.slideNo] = receipt;
  await saveServer(store, state);
}

export async function releaseClaim(store: Store, slideNo: string) {
  const state = await loadServer(store);
  delete state.claims[slideNo];
  await saveServer(store, state);
}

export async function getServerState(store: Store): Promise<ServerState> {
  return loadServer(store);
}

export async function isOnline(): Promise<boolean> {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
