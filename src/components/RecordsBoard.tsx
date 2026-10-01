import { useStore } from "../state/store";
import { RecordCard } from "./RecordCard";
import type { ObservationRecord } from "../types";

interface Lane {
  key: string;
  title: string;
  hint: string;
  records: ObservationRecord[];
  emphasis?: boolean;
}

export function RecordsBoard() {
  const { state, syncing, recompute, acceptSnapshot, retryRecord, correctRecord } = useStore();

  const lanes: Lane[] = [
    {
      key: "pending",
      title: "① 待同步 / 写入中断",
      hint: "离线补录的草稿与未完成条目；回网后逐条按玻片编号换取中心回执，中断后只重试未完成部分",
      records: state.records.filter(
        (r) =>
          !r.snapshotId &&
          (r.state === "draft" || r.state === "submitting" || r.state === "write_failed")
      ),
    },
    {
      key: "check",
      title: "② 待核区（停在这里）",
      hint: "回执拒收、玻片编号被别的玻片占用、或双方字段对不上；列出本地与中心双方值，更正后重新排队",
      records: state.records.filter((r) => r.state === "pending_check"),
      emphasis: true,
    },
    {
      key: "verified",
      title: "③ 已核对",
      hint: "中心回执接收且字段一致；测量结论有效即可固化为已验收快照，失效的需先重算",
      records: state.records.filter((r) => r.state === "verified" && !r.snapshotId),
    },
    {
      key: "locked",
      title: "④ 已进入验收快照",
      hint: "结论与依赖版本已固化，染色批次/标尺后续升版不改变该快照",
      records: state.records.filter((r) => !!r.snapshotId),
    },
  ];

  return (
    <section className="board">
      {lanes.map((lane) => (
        <div key={lane.key} className={`lane ${lane.emphasis ? "lane-emphasis" : ""}`}>
          <div className="lane-head">
            <h2>
              {lane.title} <span className="lane-count">{lane.records.length}</span>
            </h2>
            <p>{lane.hint}</p>
          </div>
          {lane.records.length === 0 ? (
            <p className="hint lane-empty">暂无记录</p>
          ) : (
            <div className="lane-cards">
              {lane.records.map((r) => (
                <RecordCard
                  key={r.id}
                  record={r}
                  scaleName={state.scales.find((s) => s.id === r.scaleId)?.name ?? r.scaleId}
                  syncing={syncing}
                  onRecompute={recompute}
                  onAccept={acceptSnapshot}
                  onRetry={retryRecord}
                  onCorrect={correctRecord}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
