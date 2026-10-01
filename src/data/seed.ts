import {
  createCentralClient,
  createObservation,
  createSample,
  createScaleVersion,
  createStainBatch,
  processOutbox,
  queueForSync,
  sampleFingerprint,
} from "../domain/engine";
import type { Store } from "../domain/store";
import type { CentralReceipt, ServerState } from "../domain/types";

const dayStart = (offset: number) => {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
};

/**
 * 预置可追溯场景：
 * - BP-1001 洋葱表皮：中心已接收且一致
 * - BP-1002 人血涂片：中心拒收（破损）
 * - BP-1003 人口腔上皮：双方染色批次对不上
 * - BP-1004 草履虫：中心尚未生成回执（等待回网核对）
 * - BP-1005 蚕豆根尖：离线草稿，未加入队列
 */
export async function seedDemo(store: Store): Promise<void> {
  const meta = await store.meta.get("seededAt");
  if (meta) return;

  const wright = await createStainBatch(store, {
    code: "ST-2026-014",
    method: "瑞氏染色",
    note: "本学期血液涂片批次",
  });
  const iodine = await createStainBatch(store, {
    code: "ST-2026-007",
    method: "碘液染色",
  });
  const methylene = await createStainBatch(store, {
    code: "ST-2026-021",
    method: "亚甲基蓝染色",
  });
  const scaleOil = await createScaleVersion(store, {
    scope: "1000x 油镜",
    umPerPixel: 0.109,
    note: "2026-09 测微尺标定",
  });
  const scaleLow = await createScaleVersion(store, {
    scope: "200x/400x 低倍",
    umPerPixel: 0.52,
  });

  const s1 = await createSample(store, {
    slideNo: "BP-1001",
    name: "洋葱表皮",
    specimenType: "植物组织",
    stainBatchId: iodine.id,
    collector: "王助教",
    collectedAt: dayStart(-2),
  });
  const s2 = await createSample(store, {
    slideNo: "BP-1002",
    name: "人血涂片",
    specimenType: "血液涂片",
    stainBatchId: wright.id,
    collector: "李镜检",
    collectedAt: dayStart(-1),
  });
  const s3 = await createSample(store, {
    slideNo: "BP-1003",
    name: "人口腔上皮",
    specimenType: "动物组织",
    stainBatchId: methylene.id,
    collector: "王助教",
    collectedAt: dayStart(-1),
  });
  const s4 = await createSample(store, {
    slideNo: "BP-1004",
    name: "草履虫活体",
    specimenType: "微生物",
    stainBatchId: wright.id, // 活体观察批次仅做登记
    collector: "张同学",
    collectedAt: dayStart(0),
  });
  const s5 = await createSample(store, {
    slideNo: "BP-1005",
    name: "蚕豆根尖纵切",
    specimenType: "植物组织",
    stainBatchId: iodine.id,
    collector: "张同学",
    collectedAt: dayStart(0),
  });

  const r1 = await createObservation(store, {
    sampleId: s1.id,
    microscopist: "李镜检",
    magnification: "400x",
    structures: "细胞壁、细胞核",
    description: "细胞壁清晰，细胞核经碘液染色呈棕黄，核膜完整。",
    scaleVersionId: scaleLow.id,
    measurements: [{ feature: "细胞核直径", pixels: 24 }],
  });
  const r2 = await createObservation(store, {
    sampleId: s2.id,
    microscopist: "李镜检",
    magnification: "1000x",
    structures: "红细胞",
    description: "涂片局部有划痕，红细胞分布尚均匀。",
    scaleVersionId: scaleOil.id,
    measurements: [{ feature: "红细胞直径", pixels: 68 }],
  });
  const r3 = await createObservation(store, {
    sampleId: s3.id,
    microscopist: "陈镜检",
    magnification: "400x",
    structures: "上皮细胞核",
    description: "上皮细胞成片，核质比正常。",
    scaleVersionId: scaleLow.id,
    measurements: [{ feature: "细胞核直径", pixels: 19 }],
  });
  const r4 = await createObservation(store, {
    sampleId: s4.id,
    microscopist: "陈镜检",
    magnification: "200x",
    structures: "纤毛、口沟",
    description: "纤毛摆动明显，运动活跃，活体观察。",
    scaleVersionId: scaleLow.id,
    measurements: [],
  });

  for (const id of [r1.id, r2.id, r3.id, r4.id]) await queueForSync(store, id);

  // BP-1005：离线草稿，尚未加入发送队列
  await createObservation(store, {
    sampleId: s5.id,
    microscopist: "陈镜检",
    magnification: "400x",
    structures: "根尖分生区、有丝分裂期细胞",
    description: "离线补录：可见前、中期分裂相，回网后再提交核对。",
    scaleVersionId: scaleLow.id,
    measurements: [{ feature: "分裂期细胞直径", pixels: 31 }],
  });

  // 中心实验室侧的既有状态
  const t = Date.now();
  const receipts: CentralReceipt[] = [
    {
      id: "RC-7701",
      slideNo: "BP-1001",
      accepted: true,
      sampleFingerprint: s1.fingerprint,
      stainBatchCode: "ST-2026-007",
      receivedAt: t - 3600_000,
    },
    {
      id: "RC-7702",
      slideNo: "BP-1002",
      accepted: false,
      sampleFingerprint: s2.fingerprint,
      stainBatchCode: "ST-2026-014",
      receivedAt: t - 3000_000,
      note: "玻片运输破损，无法镜检",
    },
    {
      // 中心登记的是另一批次，与本地 ST-2026-021 不符
      id: "RC-7703",
      slideNo: "BP-1003",
      accepted: true,
      sampleFingerprint: sampleFingerprint({
        stainBatchCode: "ST-2026-020",
        specimenType: "动物组织",
        collectedAt: dayStart(-1),
      }),
      stainBatchCode: "ST-2026-020",
      receivedAt: t - 1800_000,
    },
  ];
  const state: ServerState = {
    claims: {
      "BP-1001": {
        slideNo: "BP-1001",
        recordId: r1.id,
        microscopist: "李镜检",
        claimedAt: t - 7200_000,
      },
    },
    receipts: Object.fromEntries(receipts.map((r) => [r.slideNo, r])),
  };
  await store.server.set("state", state);

  // 预置一次已完成的同步，使三条记录到达各自状态（BP-1004 无回执，留在待提交）
  const client = createCentralClient(store);
  await processOutbox(store, client);

  await store.meta.set("seededAt", new Date().toISOString());
}
