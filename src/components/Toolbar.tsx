import { useStore } from "../state/store";
import { selectPending } from "../domain/engine";
import { PRE_OCCUPIED_SLIDE, CENTRAL_REJECT_SLIDE } from "../domain/seed";

// 顶部流程控制：联网状态、同步、并发/中断演示
export function Toolbar() {
  const { state, syncing, runSync, setOnline, resetAll, demoConcurrent, demoInterruption } =
    useStore();
  const pendingCount = selectPending(state.records).length;
  const pendingCheckCount = state.records.filter((r) => r.state === "pending_check").length;

  return (
    <div className="toolbar">
      <div className={`net-pill ${state.online ? "online" : "offline"}`}>
        <i />
        {state.online ? "在线 · 可核对中心回执" : "离线 · 本地补录中"}
      </div>
      <button onClick={() => setOnline(!state.online)}>
        {state.online ? "断开网络（演示离线补录）" : "恢复网络"}
      </button>
      <button className="primary-action" onClick={() => void runSync()} disabled={syncing || !state.online}>
        {syncing ? "同步中…" : `回网核对回执（${pendingCount} 条待同步）`}
      </button>
      <button
        onClick={() => void demoConcurrent()}
        disabled={!state.online || syncing}
        title="两名镜检员同时提交同一玻片编号"
      >
        演示并发抢同一编号
      </button>
      <button
        onClick={demoInterruption}
        disabled={syncing || pendingCount === 0}
        title="中心已落库但响应回程丢失"
      >
        注入写入中断
      </button>
      <button className="ghost" onClick={() => void resetAll()}>
        重置演示数据
      </button>
      {pendingCheckCount > 0 && <span className="pending-hint">待核区 {pendingCheckCount} 条</span>}
      <span className="toolbar-secret">
        提示：补录编号填 {PRE_OCCUPIED_SLIDE}（占用）或 {CENTRAL_REJECT_SLIDE}（拒收）可触发待核
      </span>
    </div>
  );
}
