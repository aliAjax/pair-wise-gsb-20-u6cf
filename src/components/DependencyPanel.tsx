import { useStore } from "../state/store";
import { PRE_OCCUPIED_SLIDE, CENTRAL_REJECT_SLIDE } from "../domain/seed";

// 染色批次 / 标尺版本：升版后依赖其的测量结论失效等待重算
export function DependencyPanel() {
  const { state, bumpStain, bumpScale } = useStore();
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>依赖版本</p>
          <h2>染色批次与标尺</h2>
        </div>
      </div>

      <h3 className="dep-sub">染色批次</h3>
      <div className="dep-list">
        {state.stainBatches.map((b) => (
          <div key={b.id} className="dep-row">
            <div>
              <strong>{b.name}</strong>
              <span className="dep-method">{b.method}</span>
            </div>
            <span className="version-tag">v{b.version}</span>
            <button className="small" onClick={() => bumpStain(b.id)}>
              换批/升版
            </button>
          </div>
        ))}
      </div>

      <h3 className="dep-sub">标尺</h3>
      <div className="dep-list">
        {state.scales.map((s) => (
          <div key={s.id} className="dep-row">
            <div>
              <strong>{s.name}</strong>
              <span className="dep-method">{s.micronsPerPixel} μm/px</span>
            </div>
            <span className="version-tag">v{s.version}</span>
            <button className="small" onClick={() => bumpScale(s.id)}>
              重新标定/升版
            </button>
          </div>
        ))}
      </div>

      <p className="dep-note">
        升版只影响尚未验收的记录：测量结论转为「失效待重算」，重算前无法进入已验收快照；
        已固化的快照保持原版本结论不变。
      </p>
      <p className="dep-note muted">
        演示编号：{PRE_OCCUPIED_SLIDE} 已被外校玻片占用；{CENTRAL_REJECT_SLIDE} 中心按破损拒收。
      </p>
    </section>
  );
}
