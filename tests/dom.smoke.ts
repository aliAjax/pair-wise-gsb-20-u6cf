// 真实 React 渲染冒烟测试：jsdom + fake-indexeddb，
// 走 IndexedDB 持久化与 store 的完整交互（离线补录→回网→重算→快照）。
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost:5106",
  pretendToBeVisual: true,
});
(globalThis as { window: unknown }).window = dom.window;
(globalThis as { document: Document }).document = dom.window.document;
(globalThis as { navigator: unknown }).navigator = dom.window.navigator;
dom.window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0)) as typeof requestAnimationFrame;
dom.window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore, type StoreApi } from "../src/state/store";
import { loadState, clearState } from "../src/services/storage";
import { eq, finish, ok, test } from "./harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let storeRef: { current: ReturnType<typeof useStore> | null } = { current: null };
function Probe() {
  storeRef.current = useStore();
  return null;
}
// 始终拿最新一次渲染的 store（context value 每次状态变化都会重建）
const api = (): StoreApi => {
  if (!storeRef.current) throw new Error("store 未挂载");
  return storeRef.current;
};

async function flush(ms = 10) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

await test("完整交互链路冒烟", async () => {
  await clearState();
  const container = document.getElementById("root") as HTMLDivElement;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(StoreProvider, null, React.createElement(Probe)));
  });

  // 1) 离线
  await act(async () => api().setOnline(false)); 
  ok(api().state.online === false, "已切到离线");

  // 2) 离线补录
  await act(async () => {
    api().addRecord({
      slideNo: "SL-SMOKE-001",
      sampleId: api().state.samples[0].id,
      scaleId: api().state.scales[0].id,
      magnification: "400x",
      rawPixels: 210,
      structure: "冒烟核径",
      description: "浏览器外冒烟",
      microscopist: "冒烟镜检员",
    });
  });
  const recId = api().state.records.find((r) => r.slideNo === "SL-SMOKE-001")!.id;
  eq(api().state.records[0].state, "draft");
  ok(api().state.records[0].measurement!.conclusion.includes("μm"));

  // 离线点同步：不产生请求
  await act(async () => {
    await api().runSync();
  });
  eq(api().state.records.find((r) => r.id === recId)!.state, "draft");

  // 3) 回网并同步
  await act(async () => api().setOnline(true));
  await act(async () => {
    await api().runSync();
  });
  eq(api().state.records.find((r) => r.id === recId)!.state, "verified");
  ok(api().state.records.find((r) => r.id === recId)!.receipt?.status === "accepted");

  // 4) 染色批次升版 → 失效，且验收被挡
  const batchId = api().state.records.find((r) => r.id === recId)!.stainBatchId;
  const beforeCount = api().state.snapshots.length;
  await act(async () => api().bumpStain(batchId));
  eq(api().state.records.find((r) => r.id === recId)!.measurement!.calcStatus, "stale");
  await act(async () => api().acceptSnapshot(recId));
  eq(api().state.snapshots.length, beforeCount, "失效结论进不了快照");

  // 5) 重算 → 验收成功
  await act(async () => api().recompute(recId));
  eq(api().state.records.find((r) => r.id === recId)!.measurement!.calcStatus, "current");
  await act(async () => api().acceptSnapshot(recId));
  eq(api().state.snapshots.length, beforeCount + 1, "快照 +1");
  const snap = api().state.snapshots.find((s) => s.recordId === recId)!;
  eq(snap.slideNo, "SL-SMOKE-001");
  eq(snap.conclusion, api().state.records.find((r) => r.id === recId)!.measurement!.conclusion);

  // 6) IndexedDB 落库校验
  await flush(20);
  const persisted = await loadState();
  ok(persisted, "IndexedDB 中存在持久化状态");
  ok(persisted!.records.find((r) => r.id === recId)!.snapshotId, "刷新后仍标记已入快照");
  ok(persisted!.snapshots.some((s) => s.recordId === recId), "快照已持久化");

  // 7) 已入快照后批次再升版不影响结论
  await act(async () => api().bumpStain(batchId));
  eq(api().state.records.find((r) => r.id === recId)!.measurement!.calcStatus, "current");

  root.unmount();
});

await test("并发演示：同一编号两条只放行一条", async () => {
  await clearState();
  const container = document.getElementById("root") as HTMLDivElement;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(StoreProvider, null, React.createElement(Probe)));
  });
  await flush(60);

  const before = api().state.records.length;
  await act(async () => {
    await api().demoConcurrent();
  });
  const added = api().state.records.slice(0, 2);
  eq(added.length, 2);
  const states = added.map((r) => r.state).sort();
  eq(states, ["pending_check", "verified"], "一条已核对，一条停待核区");
  const loser = added.find((r) => r.state === "pending_check")!;
  ok(loser.occupant, "落败方带占用方信息");
  ok(api().state.records.length === before + 2);

  root.unmount();
});

await test("中断演示：中心落库后响应丢失，再次同步幂等重放", async () => {
  await clearState();
  const container = document.getElementById("root") as HTMLDivElement;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(StoreProvider, null, React.createElement(Probe)));
  });
  await flush(60);

  // 注入一次中断并运行（目标为队列首条：草稿 SL-2026-1002）
  await act(async () => {
    api().demoInterruption();
  });
  await flush(1500);
  const failedFirst = api().state.records.filter((r) => r.state === "write_failed").length;
  ok(failedFirst >= 1, "存在写入中断条目");

  // 再同步：该条命中幂等登记，转为已核对且不重复建档
  await act(async () => {
    await api().runSync();
  });
  await flush(1200);
  const stillFailed = api().state.records.filter((r) => r.state === "write_failed");
  eq(stillFailed.length, 0, "重试后无中断条目");
  const replayed = api().state.records.find((r) => r.idempotentReplay === true);
  ok(replayed, "至少一条为重试幂等重放");

  root.unmount();
});

finish();
