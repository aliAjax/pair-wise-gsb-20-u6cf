import { CentralLabService } from "../src/services/centralLab";
import { eq, ok, test } from "./harness";

let t = 1_700_000_000_000;
const clock = () => t;

function payload(over: Partial<Parameters<CentralLabService["submit"]>[0]> = {}) {
  return {
    recordId: "rec-1",
    slideNo: "SL-100",
    sampleName: "洋葱表皮",
    stainBatchName: "HE B04",
    microscopist: "王镜检",
    ...over,
  };
}

export async function centralTests() {
  await test("正常提交返回接收回执", async () => {
    const lab = new CentralLabService(clock);
    const res = await lab.submit(payload());
    eq(res.outcome, "accepted");
    if (res.outcome === "accepted") {
      ok(res.receipt.status === "accepted");
      eq(res.idempotentReplay, false);
    }
  });

  await test("拒收规则 → rejected 回执带原因", async () => {
    const lab = new CentralLabService(clock);
    lab.setRejectRule("SL-900", "玻片碎裂");
    const res = await lab.submit(payload({ slideNo: "SL-900" }));
    eq(res.outcome, "rejected");
    if (res.outcome === "rejected") eq(res.receipt.rejectReason, "玻片碎裂");
  });

  await test("预置占用 → occupied 返回占用方", async () => {
    const lab = new CentralLabService(clock);
    lab.seedRegistry([
      {
        slideNo: "SL-777",
        occupant: {
          holderRecordId: "ext-1",
          holderLabRef: "OLD-1",
          holderSampleName: "蚕豆叶",
        },
      },
    ]);
    const res = await lab.submit(payload({ slideNo: "SL-777", recordId: "local-9" }));
    eq(res.outcome, "occupied");
    if (res.outcome === "occupied") {
      eq(res.occupant.holderRecordId, "ext-1");
      eq(res.occupant.holderSampleName, "蚕豆叶");
    }
  });

  await test("两名镜检员并发提交同一玻片编号：只放行一条", async () => {
    const lab = new CentralLabService(clock);
    const [a, b] = await Promise.all([
      lab.submit(payload({ recordId: "A", sampleName: "甲机样本" })),
      lab.submit(payload({ recordId: "B", sampleName: "乙机样本" })),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    eq(outcomes, ["accepted", "occupied"]);
    const accepted = a.outcome === "accepted" ? a : b;
    const occupied = a.outcome === "occupied" ? a : b;
    eq((accepted as { receipt: { slideNo: string } }).receipt.slideNo, "SL-100");
    ok(occupied.outcome === "occupied" && occupied.occupant.holderRecordId !== "");
  });

  await test("dropOnce：中心已落库响应丢失，重试幂等重放同一张回执且不重复", async () => {
    const lab = new CentralLabService(clock);
    lab.fault = { kind: "dropOnce", recordId: "rec-1" };
    const first = await lab.submit(payload());
    eq(first.outcome, "network_error");

    const second = await lab.submit(payload());
    eq(second.outcome, "accepted");
    if (second.outcome === "accepted") {
      eq(second.idempotentReplay, true);
      // 再来一次仍是同一张回执（登记册只有一条）
      const third = await lab.submit(payload());
      ok(third.outcome === "accepted" && third.idempotentReplay === true);
      if (third.outcome === "accepted") {
        eq(
          (second as { receipt: { receiptNo: string } }).receipt.receiptNo,
          third.receipt.receiptNo
        );
      }
    }
  });

  await test("离线时提交 → network_error 且不占位", async () => {
    const lab = new CentralLabService(clock);
    lab.online = false;
    const res = await lab.submit(payload());
    eq(res.outcome, "network_error");
    lab.online = true;
    const retry = await lab.submit(payload());
    eq(retry.outcome, "accepted");
    eq(retry.outcome === "accepted" && retry.idempotentReplay, false);
  });
}
