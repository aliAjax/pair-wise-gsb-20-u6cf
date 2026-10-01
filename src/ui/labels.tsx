import type { PipelineStatus } from "../domain/types";

export const STATUS_LABEL: Record<PipelineStatus, string> = {
  draft: "离线草稿",
  queued: "待发送",
  submitted: "已提交·待回执",
  accepted: "已验收",
  in_review: "待核",
  rejected: "已拒收",
};

export const STATUS_CLASS: Record<PipelineStatus, string> = {
  draft: "badge-neutral",
  queued: "badge-amber",
  submitted: "badge-blue",
  accepted: "badge-green",
  in_review: "badge-red",
  rejected: "badge-darkred",
};

export function StatusBadge({ status }: { status: PipelineStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function fmtTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtFull(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
