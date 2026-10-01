import {
  applySubmitResult,
  canAccept,
  compareFields,
  computeMeasurement,
  createSnapshot,
  markStaleForDeps,
  queueRecord,
  recomputeMeasurement,
  selectPending,
} from "../src/domain/engine";
import type { LabReceipt, ObservationRecord, StainBatch } from "../src/types";
import { createSeedState } from "../src/domain/seed";
import { eq, ok, test } from "./harness";

const batch: StainBatch = {
  id: "b1",
  name: "HE B04",
  method: "HE",
  version: 4,
};
const scale = { id: "s1", name: "目镜尺", micronsPerPixel: 0.12, version: 3 };

function baseRec(over: Partial<ObservationRecord> = {}): ObservationRecord {
  const now = 1_700_000_000_000;
  const rec: ObservationRecord = {
    id: "r1",
    slideNo: "SL-1",
    sampleId: "smp1",
    sampleName: "洋葱表皮",
    stainBatchId: batch.id,
    stainBatchName: batch.name,
    scaleId: scale.id,
    magnification: "400x",
    description: "",
    microscopist: "王镜检",
    createdAt: now,
    updatedAt: now,
    state: "submitting",
    queued: false,
    attempts: 0,
    ...over,
  };
  rec.measurement =
    over.measurement ?? computeMeasurement(rec, 200, "细胞核", batch, scale, now);
  return rec;
}

function acceptedReceipt(p: Partial<LabReceipt> = {}): LabReceipt {
  return {
    receiptNo: "RCV-1",
    slideNo: "SL-1",
    sampleName: "洋葱表皮",
    stainBatchName: "HE B04",
    status: "accepted",
    receivedAt: 1_700_000_001_000,
    ...p,
  };
}

export async function engineTests() {
  await test("回执接收且字段一致 → 已核对", () => {
    const out = applySubmitResult(baseRec(), {
      outcome: "accepted",
      receipt: acceptedReceipt(),
      idempotentReplay: false,
    });
    eq(out.record.state, "verified");
    eq(out.record.receipt?.receiptNo, "RCV-1");
    eq(out.record.discrepancies, undefined);
  });

  await test("回执拒收 → 停待核区并保留拒收原因", () => {
    const out = applySubmitResult(baseRec(), {
      outcome: "rejected",
      receipt: acceptedReceipt({
        receiptNo: "RJT-9",
        status: "rejected",
        rejectReason: "玻片碎裂",
      }),
    });
    eq(out.record.state, "pending_check");
    eq(out.record.rejectReason, "玻片碎裂");
    ok(canAccept(out.record) === false);
  });

  await test("编号被别的玻片占用 → 停待核区并带占用方信息", () => {
    const out = applySubmitResult(baseRec(), {
      outcome: "occupied",
      slideNo: "SL-1",
      occupant: {
        holderRecordId: "ext-1",
        holderLabRef: "RCV-OLD",
        holderSampleName: "蚕豆叶",
        receivedAt: 1_699_900_000_000,
      },
    });
    eq(out.record.state, "pending_check");
    eq(out.record.occupant?.holderSampleName, "蚕豆叶");
    eq(out.record.queued, false);
  });

  await test("回执字段对不上 → 待核区列出双方值", () => {
    const receipt = acceptedReceipt({ sampleName: "人口腔上皮" });
    const rows = compareFields(
      { slideNo: "SL-1", sampleName: "洋葱表皮", stainBatchName: "HE B04" },
      receipt
    );
    eq(rows.length, 1);
    eq(rows[0].field, "样本名称");
    eq(rows[0].local, "洋葱表皮");
    eq(rows[0].central, "人口腔上皮");

    const out = applySubmitResult(baseRec(), {
      outcome: "accepted",
      receipt,
      idempotentReplay: false,
    });
    eq(out.record.state, "pending_check");
    eq(out.record.discrepancies?.length, 1);
  });

  await test("写入中断 → write_failed 且继续排队只重试本条", () => {
    const out = applySubmitResult(baseRec(), {
      outcome: "network_error",
      slideNo: "SL-1",
      message: "TCP 中断",
    });
    eq(out.record.state, "write_failed");
    eq(out.record.queued, true);
    eq(out.record.lastError, "TCP 中断");
    eq(out.record.attempts, 1);
  });

  await test("幂等重放标记：重试命中中心登记不重复建档", () => {
    const out = applySubmitResult(baseRec(), {
      outcome: "accepted",
      receipt: acceptedReceipt(),
      idempotentReplay: true,
    });
    eq(out.record.state, "verified");
    eq(out.record.idempotentReplay, true);
  });

  await test("依赖升版 → 结论失效；已入快照的不受影响", () => {
    const stale = baseRec({ id: "r-stale", state: "verified" });
    const locked = { ...baseRec({ id: "r-locked", state: "verified" }), snapshotId: "snap-1" };
    const next = markStaleForDeps([stale, locked], { stainBatchId: batch.id });
    eq(next[0].measurement?.calcStatus, "stale");
    eq(next[1].measurement?.calcStatus, "current");
    ok(canAccept(next[0]) === false, "失效结论不得验收");
  });

  await test("失效结论重算后恢复有效，方可进入快照", () => {
    const seeded = createSeedState();
    const staleRec = seeded.records.find((r) => r.measurement?.calcStatus === "stale")!;
    ok(staleRec, "种子里应有失效记录");
    ok(canAccept(staleRec) === false);

    const b = seeded.stainBatches.find((x) => x.id === staleRec.stainBatchId)!;
    const s = seeded.scales.find((x) => x.id === staleRec.scaleId)!;
    const recalculated = recomputeMeasurement(staleRec, b, s);
    eq(recalculated.measurement?.calcStatus, "current");
    eq(recalculated.measurement?.stainVersion, b.version);
    eq(recalculated.measurement?.scaleVersion, s.version);
    ok(canAccept(recalculated));

    const snap = createSnapshot(recalculated, s.name);
    eq(snap.slideNo, recalculated.slideNo);
    eq(snap.stainVersion, b.version);
    eq(snap.scaleVersion, s.version);
    // 快照是不可变的独立对象
    ok(snap.conclusion === recalculated.measurement!.conclusion);
  });

  await test("createSnapshot 对非已核对/失效记录抛错", () => {
    const stale = { ...baseRec({ state: "verified" }) };
    stale.measurement = { ...stale.measurement!, calcStatus: "stale" };
    let threw = false;
    try {
      createSnapshot(stale, "尺");
    } catch {
      threw = true;
    }
    ok(threw, "未重算的失效结论必须被挡在快照外");

    let threw2 = false;
    try {
      createSnapshot(baseRec({ state: "pending_check", receipt: undefined }), "尺");
    } catch {
      threw2 = true;
    }
    ok(threw2, "待核记录不能进快照");
  });

  await test("selectPending 只挑未完成条目，已核对/待核/已入快照不重试", () => {
    const seeded = createSeedState();
    const pending = selectPending(seeded.records).map((r) => r.id).sort();
    ok(pending.includes("rec-blood-02"), "草稿在队列");
    ok(pending.includes("rec-para-04"), "写入失败在队列");
    ok(!pending.includes("rec-onion-01"), "已核对不重试");
    ok(!pending.includes("rec-cheek-03"), "已核对（即使失效）不重发回执");
  });

  await test("手动重试只入队该条", () => {
    const seeded = createSeedState();
    const failed = seeded.records.find((r) => r.id === "rec-para-04")!;
    const requeued = queueRecord({ ...failed, lastError: undefined }, true);
    eq(requeued.queued, true);
    eq(selectPending([...seeded.records.filter((r) => r.id !== failed.id), requeued]).length, 2);
  });

  await test("测量结论同时固化批次与标尺版本", () => {
    const m = computeMeasurement(baseRec(), 200, "核", { ...batch, version: 9 }, { ...scale, version: 8 });
    eq(m.stainVersion, 9);
    eq(m.scaleVersion, 8);
    ok(m.conclusion.includes("μm"));
  });
}
