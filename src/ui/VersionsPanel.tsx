import type { Workspace } from "../data/useAcceptance";
import { fmtTime } from "./labels";

export function VersionsPanel({
  ws,
  onBumpStain,
  onBumpScale,
}: {
  ws: Workspace;
  onBumpStain: (id: string) => void;
  onBumpScale: (id: string) => void;
}) {
  return (
    <div className="versions">
      <h3>染色批次</h3>
      <p className="panel-hint">批次信息更新（版本 +1）后，引用它的测量结论立即失效，等待重算。</p>
      <div className="version-list">
        {ws.stains.map((b) => (
          <div className="version-row" key={b.id}>
            <div>
              <strong>{b.code}</strong>
              <span className="chip">v{b.version}</span>
              <p>{b.method}</p>
            </div>
            <button onClick={() => onBumpStain(b.id)} title="模拟批次信息更新">
              批次更新
            </button>
          </div>
        ))}
      </div>

      <h3>标尺版本</h3>
      <p className="panel-hint">标尺重新标定（版本 +1）后，按旧标尺换算的测量值失效；重算会按新系数换算。</p>
      <div className="version-list">
        {ws.scales.map((s) => (
          <div className="version-row" key={s.id}>
            <div>
              <strong>{s.scope}</strong>
              <span className="chip">v{s.version}</span>
              <p>
                {s.umPerPixel} μm/px · 更新于 {fmtTime(s.updatedAt)}
              </p>
            </div>
            <button onClick={() => onBumpScale(s.id)} title="模拟重新标定，系数上调 10%">
              重新标定
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
