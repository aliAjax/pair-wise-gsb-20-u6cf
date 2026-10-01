import { useStore } from "../state/store";
import { fmtTime, LOG_META } from "./uiMeta";

export function SyncLog() {
  const { state } = useStore();
  return (
    <section className="panel log-panel">
      <div className="section-heading">
        <div>
          <p>追溯日志</p>
          <h2>离线补录 · 回执核对 · 中断重试 · 失效重算</h2>
        </div>
      </div>
      <ul className="log-list">
        {state.logs.map((l) => (
          <li key={l.id} className={LOG_META[l.kind]}>
            <time>{fmtTime(l.at)}</time>
            <span>{l.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
