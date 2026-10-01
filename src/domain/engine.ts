import type {
  AcceptedSnapshot,
  AppState,
  DiscrepancyRow,
  LabReceipt,
  Measurement,
  ObservationRecord,
  StainBatch,
  SubmitResult,
} from "../types";

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function snapshotId(): string {
  return uid("snap");
}

// —— 测量结论：细胞直径依赖标尺版本，染色质量评级依赖染色批次版本 ——
export function computeMeasurement(
  rec: Pick<ObservationRecord, "slideNo" | "sampleName">,
  rawPixels: number,
  structure: string,
  batch: StainBatch,
  scale: { micronsPerPixel: number; version: number; name: string },
  now = Date.now()
): Measurement {
  const diameter = (rawPixels * scale.micronsPerPixel).toFixed(2);
  const rating = rawPixels >= 180 ? "染色充分" : rawPixels >= 120 ? "染色可辨" : "染色偏淡";
  return {
    rawPixels,
    structure,
    conclusion: `${structure} 实测径 ${diameter} μm（${scale.name}），${rating}（${batch.method}）`,
    computedAt: now,
    stainVersion: batch.version,
    scaleVersion: scale.version,
    calcStatus: "current",
  };
}

// 依赖版本更新后：已验收快照锁定不动，其余结论标记失效待重算
export function markStaleForDeps(
  records: ObservationRecord[],
  dep: { stainBatchId?: string; scaleId?: string }
): ObservationRecord[] {
  return records.map((r) => {
    if (r.snapshotId) return r;
    if (!r.measurement || r.measurement.calcStatus === "missing") return r;
    const dependsOnBatch = dep.stainBatchId && r.stainBatchId === dep.stainBatchId;
    const dependsOnScale = dep.scaleId && r.scaleId === dep.scaleId;
    if (!dependsOnBatch && !dependsOnScale) return r;
    return { ...r, measurement: { ...r.measurement, calcStatus: "stale" } };
  });
}

export function recomputeMeasurement(
  rec: ObservationRecord,
  batch: StainBatch,
  scale: { micronsPerPixel: number; version: number; name: string },
  now = Date.now()
): ObservationRecord {
  if (!rec.measurement) return rec;
  return {
    ...rec,
    measurement: computeMeasurement(
      rec,
      rec.measurement.rawPixels,
      rec.measurement.structure,
      batch,
      scale,
      now
    ),
    updatedAt: now,
  };
}

// 进入已验收快照的门槛
export function canAccept(r: ObservationRecord): boolean {
  return (
    r.state === "verified" &&
    !!r.receipt &&
    r.receipt.status === "accepted" &&
    !!r.measurement &&
    r.measurement.calcStatus === "current"
  );
}

// 快照不可变：只能追加，不能回改；结论中的依赖版本随快照固化
export function createSnapshot(
  r: ObservationRecord,
  scaleName: string,
  now = Date.now()
): AcceptedSnapshot {
  if (!canAccept(r) || !r.receipt || !r.measurement) {
    throw new Error("记录未达到验收条件（回执未核对通过或测量结论待重算）");
  }
  return {
    id: snapshotId(),
    recordId: r.id,
    slideNo: r.slideNo,
    sampleName: r.sampleName,
    stainBatchName: r.stainBatchName,
    receiptNo: r.receipt.receiptNo,
    conclusion: r.measurement.conclusion,
    scaleName,
    stainVersion: r.measurement.stainVersion,
    scaleVersion: r.measurement.scaleVersion,
    microscopist: r.microscopist,
    acceptedAt: now,
  };
}

// 核对中心回执：拒收 / 编号被别的玻片占用 / 字段值不一致 → 待核区并列双方值
export function compareFields(
  local: { slideNo: string; sampleName: string; stainBatchName: string },
  receipt: LabReceipt
): DiscrepancyRow[] {
  const rows: DiscrepancyRow[] = [];
  const pairs: Array<[string, string, string]> = [
    ["玻片编号", local.slideNo, receipt.slideNo],
    ["样本名称", local.sampleName, receipt.sampleName],
    ["染色批次", local.stainBatchName, receipt.stainBatchName],
  ];
  for (const [field, lv, cv] of pairs) {
    if (lv.trim() !== cv.trim()) rows.push({ field, local: lv, central: cv });
  }
  return rows;
}

export interface ApplyResult {
  record: ObservationRecord;
  level: "success" | "warn" | "danger";
  message: string;
}

export function applySubmitResult(
  rec: ObservationRecord,
  result: SubmitResult,
  now = Date.now()
): ApplyResult {
  const base: ObservationRecord = {
    ...rec,
    state: "write_failed",
    queued: false,
    attempts: rec.attempts + 1,
    updatedAt: now,
  };

  if (result.outcome === "network_error") {
    return {
      record: { ...base, state: "write_failed", queued: true, lastError: result.message },
      level: "danger",
      message: `玻片 ${rec.slideNo} 写入中断：${result.message}，已保留在同步队列，稍后只重试本条`,
    };
  }

  if (result.outcome === "occupied") {
    return {
      record: {
        ...base,
        state: "pending_check",
        occupant: result.occupant,
        lastError: undefined,
      },
      level: "warn",
      message: `玻片编号 ${rec.slideNo} 已被别的玻片占用，本地记录停在待核区`,
    };
  }

  if (result.outcome === "rejected") {
    return {
      record: {
        ...base,
        state: "pending_check",
        receipt: result.receipt,
        rejectReason: result.receipt.rejectReason ?? "中心实验室拒收",
        lastError: undefined,
      },
      level: "warn",
      message: `玻片 ${rec.slideNo} 被中心回执拒收（${result.receipt.rejectReason ?? "原因未注明"}）`,
    };
  }

  // accepted：仍需按双方字段核对
  const receipt = result.receipt;
  const discrepancies = compareFields(
    { slideNo: rec.slideNo, sampleName: rec.sampleName, stainBatchName: rec.stainBatchName },
    receipt
  );
  if (discrepancies.length > 0) {
    return {
      record: {
        ...base,
        state: "pending_check",
        receipt,
        discrepancies,
        lastError: undefined,
      },
      level: "warn",
      message: `玻片 ${rec.slideNo} 回执已接收但字段对不上，停在待核区并列双方值`,
    };
  }

  return {
    record: {
      ...base,
      state: "verified",
      receipt,
      discrepancies: undefined,
      rejectReason: undefined,
      occupant: undefined,
      idempotentReplay: result.idempotentReplay,
      lastError: undefined,
    },
    level: "success",
    message: result.idempotentReplay
      ? `玻片 ${rec.slideNo} 写入重试命中中心幂等登记，回执核对通过（未重复建档）`
      : `玻片 ${rec.slideNo} 回执核对通过`,
  };
}

export function markSubmitting(r: ObservationRecord, now = Date.now()): ObservationRecord {
  return { ...r, state: "submitting", updatedAt: now };
}

export function queueRecord(r: ObservationRecord, queued: boolean, now = Date.now()) {
  return { ...r, queued, updatedAt: now };
}

export function lockIntoSnapshot(r: ObservationRecord, snapId: string, now = Date.now()) {
  return { ...r, snapshotId: snapId, queued: false, updatedAt: now };
}

export function appendLog(
  state: AppState,
  kind: ApplyResult["level"] | "info",
  message: string,
  now = Date.now()
): AppState {
  return {
    ...state,
    logs: [{ id: uid("log"), at: now, kind, message }, ...state.logs].slice(0, 80),
  };
}

// 批量同步的选择器：草稿、写入失败、显式排队的记录；submitting 残留也可恢复重试
export function selectPending(records: ObservationRecord[]): ObservationRecord[] {
  return records.filter(
    (r) =>
      !r.snapshotId &&
      (r.state === "draft" || r.state === "write_failed" || r.queued) &&
      r.state !== "verified" &&
      r.state !== "pending_check"
  );
}
