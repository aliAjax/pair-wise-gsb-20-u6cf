import type { AppState, ObservationRecord } from "../types";
import { computeMeasurement } from "./engine";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function createSeedState(now = Date.now()): AppState {
  const stainBatches = [
    { id: "stain-he", name: "HE-苏木素伊红 B04", method: "HE 染色", version: 4 },
    { id: "stain-wright", name: "瑞氏染色液 W11", method: "瑞氏染色", version: 2 },
  ];
  const scales = [
    { id: "scale-ocular", name: "目镜测微尺 2025 标定", micronsPerPixel: 0.12, version: 3 },
    { id: "scale-stage", name: "台微尺校准档", micronsPerPixel: 0.1, version: 1 },
  ];
  const samples = [
    { id: "smp-onion", name: "洋葱表皮", type: "植物组织", stainBatchId: "stain-he", createdAt: now - 30 * HOUR },
    { id: "smp-blood", name: "人血涂片", type: "血液涂片", stainBatchId: "stain-wright", createdAt: now - 28 * HOUR },
    { id: "smp-paramecium", name: "草履虫", type: "微生物", stainBatchId: "stain-he", createdAt: now - 20 * HOUR },
    { id: "smp-cheek", name: "人口腔上皮", type: "动物组织", stainBatchId: "stain-he", createdAt: now - 6 * HOUR },
  ];

  const mk = (partial: Partial<ObservationRecord> & {
    id: string; slideNo: string; sampleId: string; sampleName: string;
    stainBatchId: string; stainBatchName: string; scaleId: string; state: ObservationRecord["state"];
  }): ObservationRecord => ({
    magnification: "400x",
    description: "",
    microscopist: partial.microscopist ?? "王镜检",
    createdAt: now - 4 * HOUR,
    updatedAt: now - 2 * HOUR,
    queued: false,
    attempts: 0,
    ...partial,
  });

  const batchHe = stainBatches[0];
  const scaleOc = scales[0];

  // 已核对通过、结论有效 —— 可直接进入已验收快照
  const verifiedRec = mk({
    id: "rec-onion-01",
    slideNo: "SL-2026-1001",
    sampleId: "smp-onion",
    sampleName: "洋葱表皮",
    stainBatchId: batchHe.id,
    stainBatchName: batchHe.name,
    scaleId: scaleOc.id,
    magnification: "400x",
    description: "细胞壁清晰，细胞核可见",
    microscopist: "王镜检",
    state: "verified",
    attempts: 1,
    measurement: computeMeasurement(
      { slideNo: "SL-2026-1001", sampleName: "洋葱表皮" },
      220,
      "细胞核长径",
      batchHe,
      scaleOc,
      now - 90 * MIN
    ),
    receipt: {
      receiptNo: "LAB-RCV-SEED-0001",
      slideNo: "SL-2026-1001",
      sampleName: "洋葱表皮",
      stainBatchName: batchHe.name,
      status: "accepted",
      receivedAt: now - 88 * MIN,
    },
  });

  // 离线补录的草稿，等待回网同步
  const draftRec = mk({
    id: "rec-blood-02",
    slideNo: "SL-2026-1002",
    sampleId: "smp-blood",
    sampleName: "人血涂片",
    stainBatchId: stainBatches[1].id,
    stainBatchName: stainBatches[1].name,
    scaleId: scaleOc.id,
    magnification: "1000x",
    description: "红细胞分布均匀",
    microscopist: "李镜检",
    state: "draft",
    queued: true,
    createdAt: now - 35 * MIN,
    updatedAt: now - 35 * MIN,
    measurement: computeMeasurement(
      { slideNo: "SL-2026-1002", sampleName: "人血涂片" },
      64,
      "红细胞直径",
      stainBatches[1],
      scaleOc,
      now - 33 * MIN
    ),
  });

  // 依赖旧批次版本算出的结论 —— 批次更新后失效待重算（即使回执通过也不能验收）
  const staleRec = mk({
    id: "rec-cheek-03",
    slideNo: "SL-2026-1003",
    sampleId: "smp-cheek",
    sampleName: "人口腔上皮",
    stainBatchId: batchHe.id,
    stainBatchName: batchHe.name,
    scaleId: scaleOc.id,
    magnification: "400x",
    description: "扁平上皮细胞，核居中",
    microscopist: "王镜检",
    state: "verified",
    attempts: 1,
    measurement: {
      ...computeMeasurement(
        { slideNo: "SL-2026-1003", sampleName: "人口腔上皮" },
        190,
        "上皮细胞核",
        { ...batchHe, version: batchHe.version - 1 },
        scaleOc,
        now - 5 * HOUR
      ),
      calcStatus: "stale",
    },
    receipt: {
      receiptNo: "LAB-RCV-SEED-0002",
      slideNo: "SL-2026-1003",
      sampleName: "人口腔上皮",
      stainBatchName: batchHe.name,
      status: "accepted",
      receivedAt: now - 4.8 * HOUR,
    },
  });

  // 此前写入中断，保留在同步队列等待只重试本条
  const failedRec = mk({
    id: "rec-para-04",
    slideNo: "SL-2026-1004",
    sampleId: "smp-paramecium",
    sampleName: "草履虫",
    stainBatchId: batchHe.id,
    stainBatchName: batchHe.name,
    scaleId: scales[1].id,
    magnification: "200x",
    description: "纤毛运动明显",
    microscopist: "李镜检",
    state: "write_failed",
    queued: true,
    attempts: 2,
    lastError: "写入响应丢失（TCP 中断）",
    createdAt: now - 3 * HOUR,
    updatedAt: now - 50 * MIN,
    measurement: computeMeasurement(
      { slideNo: "SL-2026-1004", sampleName: "草履虫" },
      480,
      "虫体体长",
      batchHe,
      scales[1],
      now - 170 * MIN
    ),
  });

  return {
    samples,
    stainBatches,
    scales,
    records: [verifiedRec, draftRec, staleRec, failedRec],
    snapshots: [],
    logs: [
      {
        id: "log-seed-1",
        at: now - 34 * MIN,
        kind: "info",
        message: "镜检员李镜检在离线状态补录 SL-2026-1002，已存入本地待同步队列",
      },
      {
        id: "log-seed-2",
        at: now - 40 * MIN,
        kind: "warn",
        message: "染色批次 HE-苏木素伊红 B04 更新到 v4，依赖旧版本的测量结论已标记失效",
      },
    ],
    online: true,
  };
}

// 中心登记册预置：该编号已被外校玻片占用
export const PRE_OCCUPIED_SLIDE = "SL-2025-0777";
export const CENTRAL_REJECT_SLIDE = "SL-2026-0900";
