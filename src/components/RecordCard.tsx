import { useState } from "react";
import type { ObservationRecord } from "../types";
import { canAccept } from "../domain/engine";
import { fmtDateTime, STATE_META } from "./uiMeta";

interface Props {
  record: ObservationRecord;
  scaleName: string;
  syncing: boolean;
  onRecompute: (id: string) => void;
  onAccept: (id: string) => void;
  onRetry: (id: string) => void;
  onCorrect: (
    id: string,
    patch: Partial<Pick<ObservationRecord, "slideNo" | "sampleName" | "stainBatchName">>
  ) => void;
}

function StateBadge({ state }: { state: ObservationRecord["state"] }) {
  const meta = STATE_META[state];
  return <span className={`state-badge ${meta.cls}`}>{meta.label}</span>;
}

function DiffTable({ rows }: { rows: NonNullable<ObservationRecord["discrepancies"]> }) {
  return (
    <div className="diff-box">
      <p className="diff-title">双方值核对（本地 vs 中心回执）</p>
      <table className="diff-table">
        <thead>
          <tr>
            <th>字段</th>
            <th>本地镜检记录</th>
            <th>中心实验室回执</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.field}>
              <td>{r.field}</td>
              <td className="cell-local">{r.local}</td>
              <td className="cell-central">{r.central}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CorrectForm({
  record,
  onCorrect,
}: {
  record: ObservationRecord;
  onCorrect: Props["onCorrect"];
}) {
  const [slideNo, setSlideNo] = useState(record.slideNo);
  const [sampleName, setSampleName] = useState(record.sampleName);
  const [stainBatchName, setStainBatchName] = useState(record.stainBatchName);
  const dirty =
    slideNo.trim() !== record.slideNo ||
    sampleName.trim() !== record.sampleName ||
    stainBatchName.trim() !== record.stainBatchName;

  return (
    <div className="correct-form">
      <p className="diff-title">更正后重新排队核对</p>
      <div className="correct-grid">
        <label>
          <span>玻片编号</span>
          <input value={slideNo} onChange={(e) => setSlideNo(e.target.value)} />
        </label>
        <label>
          <span>样本名称</span>
          <input value={sampleName} onChange={(e) => setSampleName(e.target.value)} />
        </label>
        <label>
          <span>染色批次</span>
          <input value={stainBatchName} onChange={(e) => setStainBatchName(e.target.value)} />
        </label>
      </div>
      <button
        className="primary-action small"
        disabled={!dirty}
        onClick={() =>
          onCorrect(record.id, {
            slideNo: slideNo.trim(),
            sampleName: sampleName.trim(),
            stainBatchName: stainBatchName.trim(),
          })
        }
      >
        更正并重新核对
      </button>
    </div>
  );
}

export function RecordCard({
  record: r,
  scaleName,
  syncing,
  onRecompute,
  onAccept,
  onRetry,
  onCorrect,
}: Props) {
  const m = r.measurement;
  const locked = !!r.snapshotId;

  return (
    <article className={`record-card-v2 ${r.state === "pending_check" ? "is-pending" : ""} ${locked ? "is-locked" : ""}`}>
      <header className="rc-head">
        <div>
          <div className="rc-title-row">
            <h3>{r.slideNo}</h3>
            <StateBadge state={locked ? "verified" : r.state} />
            {locked && <span className="state-badge st-snapshot">已入快照 {r.snapshotId!.slice(-6)}</span>}
          </div>
          <p className="rc-sub">
            {r.sampleName} · {r.stainBatchName} · {r.magnification} · 镜检员 {r.microscopist}
          </p>
        </div>
        <div className="rc-meta">
          <span>尝试 {r.attempts} 次</span>
          <span>{fmtDateTime(r.updatedAt)}</span>
        </div>
      </header>

      {r.description && <p className="rc-desc">{r.description}</p>}

      {m && (
        <div className={`measurement ${m.calcStatus === "stale" ? "is-stale" : ""}`}>
          <div className="measure-head">
            <strong>测量结论</strong>
            <span className={`calc-badge calc-${m.calcStatus}`}>
              {m.calcStatus === "current"
                ? `有效 · 批次v${m.stainVersion}/标尺v${m.scaleVersion}`
                : m.calcStatus === "stale"
                ? `结论失效待重算（基于批次v${m.stainVersion}/标尺v${m.scaleVersion}）`
                : "缺少测量"}
            </span>
          </div>
          <p>{m.conclusion}</p>
          {m.calcStatus === "stale" && !locked && (
            <div className="measure-actions">
              <button className="primary-action small" onClick={() => onRecompute(r.id)}>
                按当前批次/标尺重算
              </button>
              <span className="hint">未重算前即使回执通过也不能进入已验收快照</span>
            </div>
          )}
        </div>
      )}

      {r.state === "pending_check" && (
        <>
          {r.receipt?.status === "rejected" && (
            <div className="diff-box reject-box">
              <p className="diff-title">中心回执拒收 · {r.receipt.receiptNo}</p>
              <p className="reject-reason">拒收原因：{r.rejectReason}</p>
            </div>
          )}
          {r.occupant && (
            <div className="diff-box occupy-box">
              <p className="diff-title">玻片编号已被别的玻片占用</p>
              <dl className="occupant-grid">
                <div>
                  <dt>本地玻片</dt>
                  <dd>{r.sampleName}</dd>
                </div>
                <div>
                  <dt>占用方样本</dt>
                  <dd>{r.occupant.holderSampleName}</dd>
                </div>
                <div>
                  <dt>占用方记录</dt>
                  <dd>{r.occupant.holderRecordId}</dd>
                </div>
                <div>
                  <dt>中心建档号</dt>
                  <dd>{r.occupant.holderLabRef}</dd>
                </div>
                <div>
                  <dt>占用时间</dt>
                  <dd>{fmtDateTime(r.occupant.receivedAt)}</dd>
                </div>
              </dl>
            </div>
          )}
          {r.discrepancies && r.discrepancies.length > 0 && <DiffTable rows={r.discrepancies} />}
          <CorrectForm record={r} onCorrect={onCorrect} />
        </>
      )}

      {r.state === "write_failed" && (
        <div className="fail-row">
          <span className="fail-msg">⚠ {r.lastError ?? "写入中断"}——已完成条目不受影响，本条仅重试自己</span>
          <button className="small" disabled={syncing} onClick={() => onRetry(r.id)}>
            重试本条
          </button>
        </div>
      )}

      {r.receipt?.status === "accepted" && r.state === "verified" && (
        <div className="receipt-line">
          <span className="receipt-no">回执 {r.receipt.receiptNo}</span>
          <span className="receipt-ok">编号与字段核对一致</span>
          {r.idempotentReplay && <span className="receipt-replay">幂等重放 · 未重复建档</span>}
          <span className="hint">接收于 {fmtDateTime(r.receipt.receivedAt)} · {scaleName}</span>
        </div>
      )}

      <footer className="rc-foot">
        {canAccept(r) ? (
          <button className="primary-action small" onClick={() => onAccept(r.id)}>
            固化为已验收快照
          </button>
        ) : r.state === "verified" && m?.calcStatus === "stale" ? (
          <span className="hint danger-hint">测量结论失效待重算，重算通过后才能验收</span>
        ) : locked ? (
          <span className="hint">已验收，快照不可变；批次/标尺再更新不影响该结论</span>
        ) : (
          <span className="hint">
            {r.state === "draft" || r.state === "write_failed"
              ? "等待回网核对中心回执"
              : r.state === "submitting"
              ? "正在写入中心实验室…"
              : "待核处理中"}
          </span>
        )}
      </footer>
    </article>
  );
}
