import { useAcceptance } from "./data/useAcceptance";
import { CentralConsole } from "./ui/CentralConsole";
import { OfflineEntryForm } from "./ui/OfflineEntryForm";
import { PipelineBoard } from "./ui/PipelineBoard";
import { SnapshotPanel } from "./ui/SnapshotPanel";
import { VersionsPanel } from "./ui/VersionsPanel";
import "./styles.css";

function App() {
  const { ws, online, busy, toast, setToast, actions } = useAcceptance();

  const counts = {
    draft: ws.records.filter((r) => r.status === "draft").length,
    queue: ws.records.filter((r) => r.status === "queued" || r.status === "submitted").length,
    review: ws.records.filter((r) => r.status === "in_review" || r.status === "rejected").length,
    accepted: ws.records.filter((r) => r.status === "accepted").length,
  };
  const pendingOutbox = ws.outbox.filter(
    (e) => e.state === "pending" || e.state === "in_flight" || e.state === "error",
  ).length;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-06 · 玻片验收追溯流程</p>
          <h1>显微镜玻片观察与验收</h1>
          <p className="subtitle">
            样本 → 观察记录（离线补录）→ 回网按玻片编号核对中心回执 → 待核区列双方值 →
            染色批次/标尺版本有效 → 已验收快照。编号占用仲裁与分阶段写入保证只放行一条、中断可续传。
          </p>
        </div>
        <div className="stack-card">
          <span className={`net-dot ${online ? "on" : "off"}`}>
            {online ? "● 已回网" : "○ 离线模式"}
          </span>
          <strong>
            队列待处理 {pendingOutbox} 条
            {!online && "（回网后可核对）"}
          </strong>
          <div className="hero-actions">
            <button
              className="primary-action"
              onClick={actions.sync}
              disabled={busy || pendingOutbox === 0}
              title="处理发送队列：编号仲裁 + 回执核对"
            >
              {busy ? "处理中…" : "回网核对队列"}
            </button>
            <button onClick={actions.resetDemo} disabled={busy}>
              重置演示数据
            </button>
          </div>
        </div>
      </section>

      {toast && (
        <div className="toast" onClick={() => setToast(undefined)}>
          {toast}
          <span className="toast-close">×</span>
        </div>
      )}

      <section className="metrics-grid">
        <article className="metric-card">
          <span>离线草稿</span>
          <strong>{counts.draft}</strong>
          <i className="status-neutral" />
        </article>
        <article className="metric-card">
          <span>队列 / 待回执</span>
          <strong>{counts.queue}</strong>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>待核区</span>
          <strong>{counts.review}</strong>
          <i className="status-danger" />
        </article>
        <article className="metric-card">
          <span>已验收</span>
          <strong>{counts.accepted}</strong>
          <i className="status-ok" />
        </article>
      </section>

      <section className="entry-section panel">
        <OfflineEntryForm
          stains={ws.stains}
          scales={ws.scales}
          disabled={busy}
          onSubmit={actions.registerAndObserve}
        />
      </section>

      <PipelineBoard
        ws={ws}
        actions={{
          queue: actions.queue,
          recheck: actions.recheck,
          recompute: actions.recompute,
          bumpStain: actions.bumpStain,
          bumpScale: actions.bumpScale,
          injectFault: actions.injectFault,
        }}
      />

      <SnapshotPanel ws={ws} onBuild={actions.snapshot} />

      <section className="bottom-grid">
        <section className="panel">
          <VersionsPanel ws={ws} onBumpStain={actions.bumpStain} onBumpScale={actions.bumpScale} />
        </section>
        <section className="panel">
          <CentralConsole
            ws={ws}
            onUpsertReceipt={actions.upsertReceipt}
            onReleaseClaim={actions.releaseClaim}
          />
        </section>
      </section>

      <footer className="foot-note">
        数据保存在浏览器 IndexedDB（离线可补录、中断可恢复）；中心回执台用于联调演示，真实部署替换
        <code>src/domain/central.ts</code> 中两个方法为中心实验室 API 即可。
      </footer>
    </main>
  );
}

export default App;
