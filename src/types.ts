// 可追溯验收流程的领域模型：
// 样本 Sample → 观察记录 ObservationRecord → 中心回执 LabReceipt → 已验收快照 AcceptedSnapshot
// 染色批次 StainBatch 与标尺 ScaleVersion 是测量结论的两个依赖版本。

export type CalcStatus = "current" | "stale" | "missing";
export type RecordState =
  | "draft" // 本地草稿（离线补录）
  | "submitting" // 正在写入中心
  | "verified" // 回执核对通过，字段一致、编号无冲突
  | "pending_check" // 停在待核区：拒收 / 编号被占用 / 字段对不上
  | "write_failed"; // 写入中断（网络/服务故障），仅本条重试

export interface StainBatch {
  id: string;
  name: string;
  method: string;
  version: number; // 批次更换版本号，依赖它的结论随即失效
}

export interface ScaleVersion {
  id: string;
  name: string;
  micronsPerPixel: number;
  version: number; // 标尺标定更新版本号
}

export interface Sample {
  id: string;
  name: string;
  type: string;
  stainBatchId: string;
  createdAt: number;
}

export interface Measurement {
  rawPixels: number; // 原始像素测量，不随标尺版本变化
  structure: string;
  // —— 以下为测量结论，按 stainVersion/scaleVersion 计算 ——
  conclusion: string;
  computedAt: number;
  stainVersion: number;
  scaleVersion: number;
  calcStatus: CalcStatus;
}

export interface LabReceipt {
  receiptNo: string;
  slideNo: string;
  sampleName: string;
  stainBatchName: string;
  status: "accepted" | "rejected";
  rejectReason?: string;
  receivedAt: number;
}

export interface OccupantInfo {
  holderSampleName: string;
  holderRecordId: string;
  holderLabRef: string;
  receivedAt: number;
}

export interface DiscrepancyRow {
  field: string;
  local: string;
  central: string;
}

export interface ObservationRecord {
  id: string;
  slideNo: string;
  sampleId: string;
  sampleName: string;
  stainBatchId: string;
  stainBatchName: string;
  scaleId: string;
  magnification: string;
  description: string;
  microscopist: string;
  createdAt: number;
  updatedAt: number;
  state: RecordState;
  queued: boolean;
  attempts: number;
  measurement?: Measurement;
  receipt?: LabReceipt;
  rejectReason?: string;
  occupant?: OccupantInfo;
  discrepancies?: DiscrepancyRow[];
  idempotentReplay?: boolean; // 重试时中心确认该编号此前已写入
  lastError?: string;
  snapshotId?: string;
}

export interface AcceptedSnapshot {
  id: string;
  recordId: string;
  slideNo: string;
  sampleName: string;
  stainBatchName: string;
  receiptNo: string;
  conclusion: string;
  scaleName: string;
  stainVersion: number;
  scaleVersion: number;
  microscopist: string;
  acceptedAt: number;
}

export type SyncLogKind = "info" | "success" | "warn" | "danger";

export interface SyncLogEntry {
  id: string;
  at: number;
  kind: SyncLogKind;
  message: string;
}

export interface AppState {
  samples: Sample[];
  stainBatches: StainBatch[];
  scales: ScaleVersion[];
  records: ObservationRecord[];
  snapshots: AcceptedSnapshot[];
  logs: SyncLogEntry[];
  online: boolean;
}

// —— 中心实验室提交观察记录的返回结果 ——
export type SubmitResult =
  | {
      outcome: "accepted";
      receipt: LabReceipt;
      idempotentReplay: boolean;
    }
  | { outcome: "rejected"; receipt: LabReceipt }
  | { outcome: "occupied"; slideNo: string; occupant: OccupantInfo }
  | { outcome: "network_error"; slideNo: string; message: string };
