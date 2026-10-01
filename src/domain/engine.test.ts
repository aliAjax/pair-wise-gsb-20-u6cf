import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalCentralClient } from "./central";
import {
  buildAcceptanceSnapshot,
  createCentralClient,
  createObservation,
  createSample,
  createScaleVersion,
  createStainBatch,
  processOutbox,
  queueForSync,
  recomputeMeasurements,
  recordStaleness,
  recheckRecord,
  sampleFingerprint,
  updateScaleVersion,
  updateStainBatch,
  upsertReceipt,
} from "./engine";
import { makeMemoryStore, type Store } from "./store";
import type { CentralReceipt, ServerState } from "./types";

const DAY = 86_400_000;

async function setupFixture(
  store: Store,
  slideNo = "BP-2001",
  stainCode = "ST-X-1",
  collectedAt = Date.now() - DAY,
) {
  const stain = await createStainBatch(store, { code: stainCode, method: "碘液染色" });
  const scale = await createScaleVersion(store, { scope: "400x", umPerPixel: 0.5 });
  const sample = await createSample(store, {
    slideNo,
    name: "测试样本",
    specimenType: "植物组织",
    stainBatchId: stain.id,
    collector: "王助教",
    collectedAt,
  });
  const record = await createObservation(store, {
    sampleId: sample.id,
    microscopist: "李镜检",
    magnification: "400x",
    structures: "细胞核",
    description: "结构清晰",
    scaleVersionId: scale.id,
    measurements: [{ feature: "细胞核直径", pixels: 20 }],
  });
  return { stain, scale, sample, record };
}

function matchingReceipt(
  store: Store,
  slideNo: string,
  overrides: Partial<CentralReceipt> = {},
): Promise<CentralReceipt> {
  return store.samples.all().then(async (samples) => {
    const sample = samples.find((s) => s.slideNo === slideNo)!;
    const stains = await store.stainBatches.all();
    const stain = stains.find((b) => b.id === sample.stainBatchId)!;
    const receipt: CentralReceipt = {
      id: "RC-1",
      slideNo,
      accepted: true,
      sampleFingerprint: sample.fingerprint,
      stainBatchCode: stain.code,
      receivedAt: Date.now(),
      ...overrides,
    };
    await upsertReceipt(store, receipt);
    return receipt;
  });
}

test("回执接收且双方值一致 → accepted，并可进入已验收快照", async () => {
  const store = makeMemoryStore();
  const { record, stain, scale } = await setupFixture(store);
  assert.equal(record.measurements[0].um, 10); // 20px * 0.5
  await matchingReceipt(store, "BP-2001");
  await queueForSync(store, record.id);

  const report = await processOutbox(store, createCentralClient(store));
  assert.equal(report.accepted, 1);
  const done = await store.records.get(record.id);
  assert.equal(done!.status, "accepted");
  assert.deepEqual(done!.completedStages, ["claim", "receipt"]);

  const result = await buildAcceptanceSnapshot(store, "李镜检");
  assert.equal(result.included, 1);
  assert.equal(result.snapshot.items[0].slideNo, "BP-2001");
  assert.equal(result.snapshot.items[0].stainBatchCode, stain.code);
  assert.equal(result.snapshot.items[0].scaleVersion, scale.version);
});

test("中心回执拒收 → 停在待核区并列出双方值，不进快照", async () => {
  const store = makeMemoryStore();
  const { record } = await setupFixture(store);
  await matchingReceipt(store, "BP-2001", {
    accepted: false,
    note: "玻片破损",
  });
  await queueForSync(store, record.id);
  await processOutbox(store, createCentralClient(store));

  const blocked = await store.records.get(record.id);
  assert.equal(blocked!.status, "in_review");
  assert.equal(blocked!.blockedReason!.kind, "receipt_rejected");
  assert.deepEqual(blocked!.blockedReason!.diffs, [
    { field: "中心接收结论", local: "待验收", remote: "拒收" },
    { field: "回执编号", local: "（无）", remote: "RC-1" },
  ]);
  const result = await buildAcceptanceSnapshot(store, "李镜检");
  assert.equal(result.included, 0);
});

test("回执染色批次对不上 → 待核区，双方值逐条列出", async () => {
  const store = makeMemoryStore();
  const { record } = await setupFixture(store);
  const sample = await store.samples.all();
  const s = sample[0];
  await upsertReceipt(store, {
    id: "RC-9",
    slideNo: "BP-2001",
    accepted: true,
    sampleFingerprint: s.fingerprint,
    stainBatchCode: "ST-OTHER-9",
    receivedAt: Date.now(),
  });
  await queueForSync(store, record.id);
  await processOutbox(store, createCentralClient(store));

  const blocked = await store.records.get(record.id);
  assert.equal(blocked!.status, "in_review");
  assert.equal(blocked!.blockedReason!.kind, "stain_mismatch");
  assert.deepEqual(blocked!.blockedReason!.diffs, [
    { field: "染色批次", local: "ST-X-1", remote: "ST-OTHER-9" },
  ]);
});

test("两名镜检员同编号同时提交，中心只放行一条，落败者进待核区", async () => {
  // 两台设备各自的本地库 + 同一个中心服务端状态
  const central: ServerState = { claims: {}, receipts: {} };
  const makeClient = () =>
    new LocalCentralClient(
      async () => central,
      async (state) => {
        central.claims = state.claims;
        central.receipts = state.receipts;
      },
    );

  const storeA = makeMemoryStore();
  const storeB = makeMemoryStore();
  const fxA = await setupFixture(storeA, "BP-3001");
  const fxB = await setupFixture(storeB, "BP-3001");
  // 第二位镜检员在另一台设备上补录同编号
  const recB = await storeB.records.get(fxB.record.id);
  recB!.microscopist = "陈镜检";
  await storeB.records.put(recB!);

  await queueForSync(storeA, fxA.record.id);
  await queueForSync(storeB, fxB.record.id);

  // 两人回网，A 先到
  await processOutbox(storeA, makeClient());
  await processOutbox(storeB, makeClient());

  const a = await storeA.records.get(fxA.record.id);
  const b = await storeB.records.get(fxB.record.id);
  assert.equal(a!.status, "submitted"); // 已占用编号，等待回执
  assert.equal(b!.status, "in_review");
  assert.equal(b!.blockedReason!.kind, "slide_occupied");
  const microDiff = b!.blockedReason!.diffs.find((d) => d.field === "镜检员");
  assert.equal(microDiff!.local, "陈镜检");
  assert.equal(microDiff!.remote, "李镜检");
  // 中心只有一条占用
  assert.equal(Object.keys(central.claims).length, 1);
  assert.equal(central.claims["BP-3001"].recordId, fxA.record.id);

  // B 即使再次同步也不会翻盘（conflict 条目不再重试）
  await processOutbox(storeB, makeClient());
  assert.equal((await storeB.records.get(fxB.record.id))!.status, "in_review");

  // 中心管理员核实后释放该编号占用并下发一致回执（中心侧操作），B 重新核对
  central.claims = {};
  const sampleB = (await storeB.samples.all())[0];
  const stainB = (await storeB.stainBatches.all())[0];
  central.receipts["BP-3001"] = {
    id: "RC-3001",
    slideNo: "BP-3001",
    accepted: true,
    sampleFingerprint: sampleB.fingerprint,
    stainBatchCode: stainB.code,
    receivedAt: Date.now(),
  };
  await recheckRecord(storeB, makeClient(), fxB.record.id);
  assert.equal((await storeB.records.get(fxB.record.id))!.status, "accepted");
});

test("标尺版本更新后测量结论失效，未重算不得进入快照；重算后放行", async () => {
  const store = makeMemoryStore();
  const { record, scale } = await setupFixture(store);
  await matchingReceipt(store, "BP-2001");
  await queueForSync(store, record.id);
  await processOutbox(store, createCentralClient(store));

  const updated = await updateScaleVersion(store, scale.id, { umPerPixel: 0.6 });
  let current = await store.records.get(record.id);
  const stale = recordStaleness(current!, (await store.stainBatches.all())[0], updated);
  assert.equal(stale.stale, true);
  assert.match(stale.reasons[0], /标尺/);

  // 状态仍是已验收，但快照跳过并列原因
  let result = await buildAcceptanceSnapshot(store, "李镜检");
  assert.equal(result.included, 0);
  assert.deepEqual(result.skipped[0].slideNo, "BP-2001");

  // 重算：20px * 0.6 = 12
  await recomputeMeasurements(store, record.id);
  current = await store.records.get(record.id);
  assert.equal(current!.measurements[0].um, 12);
  assert.equal(current!.measurements[0].scaleVersionAtMeasure, 2);
  result = await buildAcceptanceSnapshot(store, "李镜检");
  assert.equal(result.included, 1);
});

test("染色批次更新同样使结论失效，重算绑定新版本", async () => {
  const store = makeMemoryStore();
  const { record, stain } = await setupFixture(store);
  await matchingReceipt(store, "BP-2001");
  await queueForSync(store, record.id);
  await processOutbox(store, createCentralClient(store));

  const v2 = await updateStainBatch(store, stain.id, { method: "碘液染色（复标）" });
  assert.equal(v2.version, 2);
  let result = await buildAcceptanceSnapshot(store, "李镜检");
  assert.equal(result.included, 0);

  await recomputeMeasurements(store, record.id);
  result = await buildAcceptanceSnapshot(store, "李镜检");
  assert.equal(result.included, 1);
  assert.equal(result.snapshot.items[0].stainVersion, 2);
});

test("写入中断：已完成阶段落盘保留，重试只跑未完成部分且不重复占用", async () => {
  const store = makeMemoryStore();
  const { record } = await setupFixture(store);
  const client = createCentralClient(store);
  await queueForSync(store, record.id);

  // 第 1 次：claim 阶段网络中断
  (client as unknown as { failOnce: (s: string, stage: "claim" | "receipt") => void }).failOnce(
    "BP-2001",
    "claim",
  );
  let report = await processOutbox(store, client);
  assert.equal(rejectStage(report), "claim");
  let current = await store.records.get(record.id);
  assert.deepEqual(current!.completedStages, []);
  assert.equal(current!.status, "queued");
  let entry = (await store.outbox.all())[0];
  assert.equal(entry.state, "pending");

  // 第 2 次：claim 成功，receipt 阶段中断（中心尚无回执也算 pending，这里用真实故障）
  (client as unknown as { failOnce: (s: string, stage: "claim" | "receipt") => void }).failOnce(
    "BP-2001",
    "receipt",
  );
  report = await processOutbox(store, client);
  assert.equal(report.failed, 1);
  current = await store.records.get(record.id);
  assert.deepEqual(current!.completedStages, ["claim"]);
  assert.equal(current!.status, "submitted");

  const server = await store.server.get("state");
  assert.equal(server!.claims["BP-2001"].recordId, record.id);

  // 第 3 次：只跑 receipt 阶段，完成验收
  await matchingReceipt(store, "BP-2001");
  report = await processOutbox(store, client);
  assert.equal(report.accepted, 1);
  entry = (await store.outbox.all())[0];
  assert.equal(entry.state, "done");
  assert.equal(entry.attempts >= 3, true);
});

test("已完成的队列条目不再处理；无回执时停留等待", async () => {
  const store = makeMemoryStore();
  const { record } = await setupFixture(store);
  await matchingReceipt(store, "BP-2001");
  await queueForSync(store, record.id);
  await processOutbox(store, createCentralClient(store));

  // 再次处理：done 条目全部跳过
  const report = await processOutbox(store, createCentralClient(store));
  assert.equal(report.processed, 0);
});

test("快照不可变：旧快照不受后续标尺更新影响", async () => {
  const store = makeMemoryStore();
  const { record, scale } = await setupFixture(store);
  await matchingReceipt(store, "BP-2001");
  await queueForSync(store, record.id);
  await processOutbox(store, createCentralClient(store));

  const first = await buildAcceptanceSnapshot(store, "李镜检", "九月底验收");
  assert.equal(first.snapshot.items[0].measurements[0].um, 10);

  await updateScaleVersion(store, scale.id, { umPerPixel: 0.8 });
  const second = await buildAcceptanceSnapshot(store, "李镜检");
  assert.equal(second.included, 0);
  // 旧快照仍是旧值
  const stored = await store.snapshots.get(first.snapshot.id);
  assert.equal(stored!.items[0].measurements[0].um, 10);
  assert.equal(stored!.note, "九月底验收");
});

test("玻片编号本地登记唯一；指纹由批次+类型+采样日决定", async () => {
  const store = makeMemoryStore();
  await setupFixture(store, "BP-4001");
  const stain = (await store.stainBatches.all())[0];
  const scale = (await store.scaleVersions.all())[0];
  await assert.rejects(
    () =>
      createSample(store, {
        slideNo: "BP-4001",
        name: "重复样本",
        specimenType: "植物组织",
        stainBatchId: stain.id,
        collector: "x",
        collectedAt: Date.now(),
      }),
    /已登记给样本/,
  );
  void scale;
  const fp = sampleFingerprint({
    stainBatchCode: "S",
    specimenType: "T",
    collectedAt: new Date("2026-09-30T08:00:00Z").getTime(),
  });
  assert.equal(fp, "S|T|2026-09-30");
});

function rejectStage(report: { failed: number; errors: string[] }) {
  assert.equal(report.failed, 1);
  const msg = report.errors[0];
  if (msg.includes("claim")) return "claim" as const;
  if (msg.includes("receipt")) return "receipt" as const;
  throw new Error(`unexpected error: ${msg}`);
}
