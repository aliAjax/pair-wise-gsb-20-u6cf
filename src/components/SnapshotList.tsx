import { useStore } from "../state/store";
import { fmtDateTime } from "./uiMeta";

// 已验收快照：只追加、不可变；结论连同批次/标尺版本一起固化
export function SnapshotList() {
  const { state } = useStore();
  return (
    <section className="panel snapshot-panel">
      <div className="section-heading">
        <div>
          <p>已验收快照（不可变 · 只追加）</p>
          <h2>中心核对一致且结论有效的验收留档</h2>
        </div>
        <span className="count-pill">{state.snapshots.length}</span>
      </div>
      {state.snapshots.length === 0 ? (
        <p className="hint empty-hint">
          还没有快照。只有「中心回执接收 + 玻片编号未被占用 + 双方字段一致 + 测量结论未失效」的记录才能固化。
        </p>
      ) : (
        <div className="snapshot-list">
          {state.snapshots.map((s) => (
            <article key={s.id} className="snapshot-card">
              <header>
                <div>
                  <h3>{s.slideNo}</h3>
                  <p>{s.sampleName} · {s.stainBatchName}</p>
                </div>
                <span className="snap-time">{fmtDateTime(s.acceptedAt)}</span>
              </header>
              <p className="snap-conclusion">{s.conclusion}</p>
              <footer>
                <span>回执 {s.receiptNo}</span>
                <span>{s.scaleName} v{s.scaleVersion}</span>
                <span>批次 v{s.stainVersion}</span>
                <span>镜检 {s.microscopist}</span>
                <span className="snap-id">{s.id}</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
