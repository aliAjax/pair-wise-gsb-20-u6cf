import "./styles.css";
import { StoreProvider, useStore } from "./state/store";
import { Toolbar } from "./components/Toolbar";
import { EntryForm } from "./components/EntryForm";
import { DependencyPanel } from "./components/DependencyPanel";
import { RecordsBoard } from "./components/RecordsBoard";
import { SnapshotList } from "./components/SnapshotList";
import { SyncLog } from "./components/SyncLog";

function Metrics() {
  const { state } = useStore();
  const cards = [
    { label: "观察记录", value: state.records.length },
    { label: "待核区", value: state.records.filter((r) => r.state === "pending_check").length },
    {
      label: "结论失效待重算",
      value: state.records.filter((r) => r.measurement?.calcStatus === "stale" && !r.snapshotId)
        .length,
    },
    { label: "已验收快照", value: state.snapshots.length },
  ];
  return (
    <section className="metrics-grid">
      {cards.map((c, i) => (
        <article key={c.label} className="metric-card">
          <span>{c.label}</span>
          <strong>{c.value}</strong>
          <i className={["status-ok", "status-watch", "status-danger", "status-ok"][i]} />
        </article>
      ))}
    </section>
  );
}

function Shell() {
  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-06 · 玻片镜检可追溯验收流程</p>
          <h1>样本 · 观察记录 · 中心回执 · 染色批次 全链路核对</h1>
          <p className="subtitle">
            镜检员离线补录，回网后按玻片编号核对中心实验室接收回执；拒收、编号被占用或双方值不符的记录停在待核区；
            染色批次或标尺升版后测量结论失效待重算，未重算不得进入不可变的已验收快照。
          </p>
        </div>
        <div className="stack-card">
          <span>持久化与并发</span>
          <strong>IndexedDB 本地库 · 顺序同步逐条落库 · 中心原子占位 + 幂等重放</strong>
        </div>
      </section>

      <Metrics />
      <Toolbar />

      <section className="workspace">
        <div className="side-col">
          <DependencyPanel />
        </div>
        <div className="main-col">
          <EntryForm />
        </div>
      </section>

      <RecordsBoard />
      <SnapshotList />
      <SyncLog />

      <footer className="page-foot">
        追溯链：样本 → 观察记录（含依赖版本） → 中心回执（编号核对） → 已验收快照（不可变）。
        刷新或关闭页面后从 IndexedDB 恢复，已完成条目不丢、不重复，只重试未完成部分。
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
