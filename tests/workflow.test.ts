import {
  applySubmitResult,
  markStaleForDeps,
  markSubmitting,
  selectPending,
} from "../src/domain/engine";
import { createSeedState } from "../src/domain/seed";
import { CentralLabService } from "../src/services/centralLab";
import type { AppState, ObservationRecord } from "../src/types";
import { eq, ok, test } from "./harness";

let t = 1_700_000_000_000;
const clock = () => t;

// 复刻 store 的顺序同步循环（逐条落库语义用本地快照代替 IndexedDB）
async function runSyncLoop(
  state: AppState,
  lab: CentralLabService,
  journal: ObservationRecord[][]
): Promise<AppState> {
  let s = state;
  let guard = 0;
  while (guard++ < 50) {
    const pending = selectPending(s.records);
    if (pending.length === 0) break;
    const rec = pending[0];
    s = { ...s, records: s.records.map((r) => (r.id === rec.id ? markSubmitting(rec) : r)) };
    journal.push(s.records); // 模拟"逐条落库"检查点
    const res = await lab.submit({
      recordId: rec.id,
      slideNo: rec.slideNo,
      sampleName: rec.sampleName,
      stainBatchName: rec.stainBatchName,
      microscopist: rec.microscopist,
    });
    const out = applySubmitResult(rec, res, clock());
    s = { ...s, records: s.records.map((r) => (r.id === rec.id ? out.record : r)) };
    journal.push(s.records);
    if (out.record.state === "write_failed") break;
  }
  return s;
}

export async function workflowTests() {
  await test("端到端：离线补录 → 回网核对 → 已核对 → 快照", async () => {
    const state = createSeedState(clock());
    const lab = new CentralLabService(clock);
    // 初始：1 草稿 + 1 写入失败待同步
    eq(selectPending(state.records).length, 2);

    const synced = await runSyncLoop(state, lab, []);
    const draft = synced.records.find((r) => r.id === "rec-blood-02")!;
    const failed = synced.records.find((r) => r.id === "rec-para-04")!;
    eq(draft.state, "verified");
    eq(failed.state, "verified");
    eq(selectPending(synced.records).length, 0);
  });

  await test("写入中断保留已完成条目，只重试未完成部分", async () => {
    let s = createSeedState(clock());
    const lab = new CentralLabService(clock);
    const journal: ObservationRecord[][] = [];

    // 队列按 records 顺序：草稿 rec-blood-02 在前，失败的 rec-para-04 在后。
    // 对后一条注入"持续中断"，第一轮应停在它上面；前一条保持已核对。
    lab.fault = { kind: "drop", recordId: "rec-para-04" };
    s = await runSyncLoop(s, lab, journal);

    const first = s.records.find((r) => r.id === "rec-blood-02")!;
    const second = s.records.find((r) => r.id === "rec-para-04")!;
    eq(first.state, "verified", "前序已完成条目不受影响");
    eq(second.state, "write_failed", "本条停在未完成");
    eq(second.queued, true);

    // 已完成的第一条不会再次出现在待同步队列
    const pendingIds = selectPending(s.records).map((r) => r.id);
    eq(pendingIds, ["rec-para-04"], "只有未完成部分重试");

    // 检查点里能看到第一条已完成的状态被持久化过
    const persistedAfterFirst = journal.some(
      (rs) =>
        rs.find((r) => r.id === "rec-blood-02")?.state === "verified" &&
        rs.find((r) => r.id === "rec-para-04")?.state !== "verified"
    );
    ok(persistedAfterFirst, "逐条落库：第一条完成时已持久化");

    // 恢复后只重试第二条
    lab.fault = { kind: "none" };
    s = await runSyncLoop(s, lab, journal);
    eq(s.records.find((r) => r.id === "rec-para-04")!.state, "verified");
    // 第一条的尝试次数不再增加（没有重放）
    eq(s.records.find((r) => r.id === "rec-blood-02")!.attempts, 1);
  });

  await test("中断恢复：崩溃时残留 submitting 重新回到待重试", () => {
    const state = createSeedState(clock());
    const crashed: AppState = {
      ...state,
      records: state.records.map((r) =>
        r.id === "rec-blood-02"
          ? ({ ...r, state: "submitting" } as ObservationRecord)
          : r
      ),
    };
    const recovered = {
      ...crashed,
      records: crashed.records.map((r) =>
        r.state === "submitting"
          ? { ...r, state: "write_failed" as const, queued: true }
          : r
      ),
    };
    const pendingIds = selectPending(recovered.records).map((r) => r.id);
    ok(pendingIds.includes("rec-blood-02"));
    ok(!pendingIds.includes("rec-onion-01"));
  });

  await test("拒收与占用在真实循环中都落入待核区且不阻塞后续条目", async () => {
    const state = createSeedState(clock());
    const lab = new CentralLabService(clock);
    lab.setRejectRule("SL-2026-1002", "标本干涸");
    lab.seedRegistry([
      {
        slideNo: "SL-2026-1004",
        occupant: {
          holderRecordId: "ext-x",
          holderLabRef: "OLD-x",
          holderSampleName: "外校玻片",
        },
      },
    ]);

    const synced = await runSyncLoop(state, lab, []);
    const rejected = synced.records.find((r) => r.id === "rec-blood-02")!;
    const occupied = synced.records.find((r) => r.id === "rec-para-04")!;
    eq(rejected.state, "pending_check");
    eq(rejected.rejectReason, "标本干涸");
    eq(occupied.state, "pending_check");
    eq(occupied.occupant?.holderSampleName, "外校玻片");
    // 待核区的条目不再出现在同步队列
    eq(selectPending(synced.records).length, 0);
  });

  await test("批次再升版不会把已入快照的结论打成失效", () => {
    const state = createSeedState(clock());
    // 手动把已核对记录置入快照（模拟验收）
    const verified = state.records.find((r) => r.id === "rec-onion-01")!;
    const locked: ObservationRecord = { ...verified, snapshotId: "snap-1" };
    const s1: AppState = {
      ...state,
      records: state.records.map((r) => (r.id === locked.id ? locked : r)),
    };
    // 批次升版（store reducer 内调用 markStaleForDeps，此处直接调用同一函数）
    const s2: AppState = { ...s1, records: markStaleForDeps(s1.records, { stainBatchId: locked.stainBatchId }) };
    const stillLocked = s2.records.find((r) => r.id === locked.id)!;
    eq(stillLocked.measurement?.calcStatus, "current");
    ok(!!stillLocked.snapshotId);
  });
}
