import { deriveRecordView, type Workspace } from "../data/useAcceptance";
import type { ObservationRecord, Sample } from "../domain/types";
import { fmtTime, StatusBadge } from "./labels";

interface Actions {
  queue: (id: string) => void;
  recheck: (id: string) => void;
  recompute: (id: string) => void;
  bumpStain: (id: string) => void;
  bumpScale: (id: string) => void;
  injectFault: (slideNo: string, stage: "claim" | "receipt") => void;
}

const LANES: { key: string; title: string; hint: string; match: (r: ObservationRecord) => boolean }[] = [
  { key: "draft", title: "离线补录", hint: "未入队的本地草稿", match: (r) => r.status === "draft" },
  {
    key: "queue",
    title: "发送队列",
    hint: "回网后按玻片编号核对中心回执；中断只重试未完成阶段",
    match: (r) => r.status === "queued" || r.status === "submitted",
  },
  {
    key: "review",
    title: "待核区",
    hint: "回执拒收 / 编号被占用 / 双方值不一致",
    match: (r) => r.status === "in_review" || r.status === "rejected",
  },
  {
    key: "accepted",
    title: "已验收",
    hint: "回执一致；测量失效时须重算才能进入快照",
    match: (r) => r.status === "accepted",
  },
];

function stageDots(record: ObservationRecord) {
  const stages: { key: "claim" | "receipt"; label: string }[] = [
    { key: "claim", label: "编号仲裁" },
    { key: "receipt", label: "回执核对" },
  ];
  return (
    <div className="stage-dots">
      {stages.map((s, i) => {
        const done = record.completedStages.includes(s.key);
        return (
          <span key={s.key} className={done ? "stage done" : "stage pending"}>
            {i + 1}.{s.label}
            {done ? " ✓" : ""}
          </span>
        );
      })}
    </div>
  );
}

function RecordCard({
  record,
  sample,
  ws,
  actions,
}: {
  record: ObservationRecord;
  sample?: Sample;
  ws: Workspace;
  actions: Actions;
}) {
  const { stain, scale, staleness } = deriveRecordView(record, ws);
  const receipt = record.receiptId ? ws.server.receipts[record.slideNo] : undefined;

  return (
    <article className={`slide-card ${staleness.stale ? "is-stale" : ""}`}>
      <header>
        <div>
          <h3>{record.slideNo}</h3>
          <p className="sub">{sample?.name ?? "（样本资料缺失）"}</p>
        </div>
        <StatusBadge status={record.status} />
      </header>

      <dl className="kv">
        <div>
          <dt>镜检员</dt>
          <dd>{record.microscopist}</dd>
        </div>
        <div>
          <dt>倍数 / 结构</dt>
          <dd>
            {record.magnification} · {record.structures || "—"}
          </dd>
        </div>
        <div>
          <dt>染色批次</dt>
          <dd>
            {!stain
              ? "批次缺失"
              : stain.version === record.stainVersionAtMeasure
                ? `${stain.code}（v${record.stainVersionAtMeasure}）`
                : `${stain.code}（观察时 v${record.stainVersionAtMeasure} → 当前 v${stain.version}）`}
          </dd>
        </div>
        <div>
          <dt>标尺依据</dt>
          <dd>
            {scale
              ? `${scale.scope} v${record.measurements[0]?.scaleVersionAtMeasure ?? "?"} · ${scale.umPerPixel}μm/px`
              : "标尺缺失"}
          </dd>
        </div>
        {record.measurements.length > 0 && (
          <div className="span-2">
            <dt>测量结论</dt>
            <dd>
              {record.measurements.map((m) => (
                <span className="chip" key={m.id}>
                  {m.feature} {m.um} μm
                </span>
              ))}
            </dd>
          </div>
        )}
        {record.receiptId && (
          <div className="span-2">
            <dt>中心回执</dt>
            <dd>
              {record.receiptId} · {receipt ? (receipt.accepted ? "接收" : "拒收") : "查无"} ·{" "}
              {fmtTime(record.receiptMatchedAt)}
            </dd>
          </div>
        )}
      </dl>

      {record.status !== "draft" && stageDots(record)}

      {staleness.stale && (
        <div className="alert warn">
          <strong>测量结论失效，等待重算：</strong>
          <ul>
            {staleness.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <button onClick={() => actions.recompute(record.id)}>按当前版本重算</button>
        </div>
      )}

      {record.blockedReason && (
        <div className="alert danger">
          <strong>{record.blockedReason.detail}</strong>
          <table className="diff-table">
            <thead>
              <tr>
                <th>核对字段</th>
                <th>本地值</th>
                <th>中心值</th>
              </tr>
            </thead>
            <tbody>
              {record.blockedReason.diffs.map((d) => (
                <tr key={d.field}>
                  <td>{d.field}</td>
                  <td className="local">{d.local}</td>
                  <td className="remote">{d.remote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card-actions">
        {record.status === "draft" && (
          <button className="primary-action" onClick={() => actions.queue(record.id)}>
            加入发送队列
          </button>
        )}
        {record.status === "in_review" && (
          <button className="primary-action" onClick={() => actions.recheck(record.id)}>
            重新核对回执
          </button>
        )}
        {(record.status === "queued" || record.status === "submitted") && (
          <span className="fault-tools">
            演示中断：
            <button onClick={() => actions.injectFault(record.slideNo, "claim")}>断在仲裁</button>
            <button onClick={() => actions.injectFault(record.slideNo, "receipt")}>断在回执</button>
          </span>
        )}
        {record.status === "accepted" && !staleness.stale && (
          <span className="ok-note">验收依据完整，可纳入快照</span>
        )}
      </div>
    </article>
  );
}

export function PipelineBoard({
  ws,
  actions,
}: {
  ws: Workspace;
  actions: Actions;
}) {
  const sampleById = new Map(ws.samples.map((s) => [s.id, s]));
  return (
    <section className="board">
      {LANES.map((lane) => {
        const records = ws.records.filter(lane.match);
        return (
          <div className="lane" key={lane.key}>
            <div className="lane-head">
              <div>
                <h2>
                  {lane.title}
                  <span className="count">{records.length}</span>
                </h2>
                <p>{lane.hint}</p>
              </div>
            </div>
            <div className="lane-body">
              {records.length === 0 && <p className="empty">暂无记录</p>}
              {records.map((r) => (
                <RecordCard
                  key={r.id}
                  record={r}
                  sample={sampleById.get(r.sampleId)}
                  ws={ws}
                  actions={actions}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
