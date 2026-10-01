import type { RecordState, SyncLogKind } from "../types";

export const STATE_META: Record<RecordState, { label: string; cls: string }> = {
  draft: { label: "本地待同步", cls: "st-draft" },
  submitting: { label: "写入中", cls: "st-submitting" },
  verified: { label: "已核对", cls: "st-verified" },
  pending_check: { label: "待核区", cls: "st-pending" },
  write_failed: { label: "写入中断", cls: "st-failed" },
};

export const LOG_META: Record<SyncLogKind, string> = {
  info: "log-info",
  success: "log-success",
  warn: "log-warn",
  danger: "log-danger",
};

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
