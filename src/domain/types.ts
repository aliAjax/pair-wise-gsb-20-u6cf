// 可追溯验收流程的领域模型：
// 样本(sample) -> 观察记录(observation) -> 中心回执(receipt) -> 验收快照(snapshot)
// 染色批次(stainBatch) / 标尺版本(scaleVersion) 为测量结论的版本化依赖。

export type ID = string;

/** 镜检状态（本地验收流程的主状态） */
export type PipelineStatus =
  | "draft" // 草稿：离线补录中
  | "queued" // 已入发送队列，等待回网
  | "submitted" // 已提交中心，等待回执
  | "accepted" // 已验收（回执一致且测量结论有效）
  | "in_review" // 待核区：回执拒收 / 编号被占用 / 双方值对不上
  | "rejected"; // 中心拒收且不可纠正

/** 单条观察在同步队列中的写入进度（断点续传用） */
export type SyncStage = "claim" | "receipt";

/** 染色批次 */
export interface StainBatch {
  id: ID;
  code: string; // 如 ST-2026-014
  method: string; // 染色方法，如 瑞氏染色
  version: number; // 批次版本，更新 +1
  active: boolean;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

/** 标尺版本（显微镜测微标尺校准） */
export interface ScaleVersion {
  id: ID;
  scope: string; // 适用对象，如 1000x 油镜
  /** 当前标定：每像素对应微米数 */
  umPerPixel: number;
  version: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

/**
 * 样本登记。
 * fingerprint 是与中心实验室对账的核对值：双方对同一张玻片必须一致。
 */
export interface Sample {
  id: ID;
  slideNo: string; // 玻片编号（全局业务唯一）
  name: string; // 样本名称
  specimenType: string; // 样本类型
  stainBatchId: ID;
  collector: string; // 采样人
  collectedAt: number;
  /** 样本指纹（染色批次编码+类型+采样日的核对串），中心回执回传同样字段 */
  fingerprint: string;
}

/** 一次测量结论，钉死测量时所用的标尺版本 */
export interface Measurement {
  id: ID;
  feature: string; // 结构名称，如 细胞核直径
  /** 被测结构像素尺寸（重算时按新标尺重新换算，原始值可复现） */
  pixels: number;
  um: number; // 计算结果（微米）
  scaleVersionId: ID;
  scaleVersionAtMeasure: number; // 测量时的标尺 version
}

/**
 * 观察记录（镜检单）。
 * 一张玻片一条；submittedBy 用于两名镜检员抢同编号时判定归属。
 */
export interface ObservationRecord {
  id: ID;
  sampleId: ID;
  slideNo: string; // 冗余玻片编号，方便直接对账
  microscopist: string; // 镜检员
  magnification: string; // 放大倍数
  structures: string; // 观察结构
  description: string; // 视野描述
  stainBatchId: ID;
  stainVersionAtMeasure: number; // 观察时染色批次 version
  scaleVersionId: ID;
  measurements: Measurement[];
  status: PipelineStatus;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  submittedBy?: string;
  acceptedAt?: number;
  /** 已完成的写入阶段（写入中断恢复用） */
  completedStages: SyncStage[];
  /** 阻塞原因（停在待核区时展示双方值） */
  blockedReason?: BlockedReason;
  /** 最近一次已匹配的中心回执编号（验收依据） */
  receiptId?: string;
  receiptMatchedAt?: number;
}

/** 停在待核区的原因与双方核对值 */
export interface BlockedReason {
  kind:
    | "receipt_rejected" // 中心回执拒收
    | "slide_occupied" // 玻片编号已被别的玻片占用
    | "fingerprint_mismatch" // 双方样本指纹不一致
    | "stain_mismatch"; // 双方染色批次不一致
  /** 本地值 vs 中心值，逐条列出 */
  diffs: { field: string; local: string; remote: string }[];
  receiptId?: string;
  detail: string;
}

/** 中心实验室下发的接收回执（对账权威） */
export interface CentralReceipt {
  id: string; // 中心回执编号
  slideNo: string;
  accepted: boolean; // 中心是否接收
  sampleFingerprint: string;
  stainBatchCode: string;
  receivedAt: number;
  note?: string;
}

/** 已验收快照：只收录测量结论仍有效的 accepted 记录，生成后不可变 */
export interface AcceptanceSnapshot {
  id: ID;
  createdAt: number;
  createdBy: string;
  items: SnapshotItem[];
  note?: string;
}

export interface SnapshotItem {
  recordId: ID;
  slideNo: string;
  sampleName: string;
  microscopist: string;
  stainBatchCode: string;
  stainVersion: number;
  scaleVersion: number;
  receiptId: string;
  measurements: { feature: string; um: number }[];
}

/** 发送队列条目：一张玻片的提交拆成 claim / receipt 两个可独立完成的写入 */
export interface OutboxEntry {
  id: ID;
  recordId: ID;
  slideNo: string;
  microscopist: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  state: "pending" | "in_flight" | "done" | "conflict" | "error";
}

export interface ServerClaim {
  slideNo: string;
  recordId: ID;
  microscopist: string;
  claimedAt: number;
}

export interface ServerState {
  claims: Record<string, ServerClaim>;
  receipts: Record<string, CentralReceipt>;
}
