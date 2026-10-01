import { deriveRecordView, type Workspace } from "../data/useAcceptance";
import { fmtFull } from "./labels";

export function SnapshotPanel({
  ws,
  onBuild,
}: {
  ws: Workspace;
  onBuild: () => void;
}) {
  const accepted = ws.records.filter((r) => r.status === "accepted");
  const stale = accepted.filter((r) => deriveRecordView(r, ws).staleness.stale);
  const ready = accepted.length - stale.length;

  return (
    <section className="panel snapshot-panel">
      <div className="section-heading">
        <div>
          <p>验收产出</p>
          <h2>已验收快照</h2>
        </div>
        <button className="primary-action" onClick={onBuild} disabled={ready === 0}>
          生成快照（{ready} 条可收录）
        </button>
      </div>
      <p className="panel-hint">
        快照只收录已验收且测量结论仍有效的记录；染色批次或标尺更新后未重算的 {stale.length}{" "}
        条会被拦下。快照生成后不可变，后续版本更新不影响已生成快照。
      </p>

      <div className="snapshots">
        {ws.snapshots.length === 0 && <p className="empty">尚未生成快照</p>}
        {ws.snapshots.map((snap) => (
          <details className="snapshot" key={snap.id}>
            <summary>
              <strong>{snap.id.replace("snp_", "SNP-")}</strong>
              <span>{fmtFull(snap.createdAt)}</span>
              <span className="chip">{snap.items.length} 条</span>
              <span className="muted">由 {snap.createdBy} 生成</span>
              {snap.note && <span className="muted">· {snap.note}</span>}
            </summary>
            <table className="snap-table">
              <thead>
                <tr>
                  <th>玻片编号</th>
                  <th>样本</th>
                  <th>镜检员</th>
                  <th>染色批次</th>
                  <th>标尺</th>
                  <th>回执</th>
                  <th>测量结论（μm）</th>
                </tr>
              </thead>
              <tbody>
                {snap.items.map((item) => (
                  <tr key={item.recordId}>
                    <td>{item.slideNo}</td>
                    <td>{item.sampleName}</td>
                    <td>{item.microscopist}</td>
                    <td>
                      {item.stainBatchCode} v{item.stainVersion}
                    </td>
                    <td>v{item.scaleVersion}</td>
                    <td>{item.receiptId}</td>
                    <td>
                      {item.measurements.map((m) => `${m.feature} ${m.um}`).join("；") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
    </section>
  );
}
