import type { LabReceipt, OccupantInfo, SubmitResult } from "../types";

interface RegisteredSlide {
  recordId: string;
  labRef: string;
  sampleName: string;
  receivedAt: number;
}

export interface CentralSubmitPayload {
  recordId: string;
  slideNo: string;
  sampleName: string;
  stainBatchName: string;
  microscopist: string;
}

export type FaultMode =
  | { kind: "none" }
  | { kind: "dropOnce"; recordId: string } // 只对某一次提交制造写入中断
  | { kind: "drop"; recordId: string } // 每次都断（直到关闭）
  | { kind: "offline" };

// 中心实验室：玻片编号登记册 + 拒收规则 + 接收回执。
// 登记册写入是原子的，两名镜检员并发提交同一编号时只有一条能成功。
export class CentralLabService {
  private registry = new Map<string, RegisteredSlide>();
  private rejectRules = new Map<string, string>(); // slideNo -> 拒收原因
  private acceptedEcho = new Map<string, LabReceipt>(); // 已接收的回执（按编号幂等返回）
  private receiptSeq = 0;
  fault: FaultMode = { kind: "none" };
  online = true;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }
  private now: () => number;

  seedRegistry(slides: Array<{ slideNo: string; occupant: Omit<OccupantInfo, "receivedAt"> }>) {
    for (const s of slides) {
      this.registry.set(s.slideNo, {
        recordId: s.occupant.holderRecordId,
        labRef: s.occupant.holderLabRef,
        sampleName: s.occupant.holderSampleName,
        receivedAt: this.now() - 1000 * 60 * 60 * 26,
      });
    }
  }

  setRejectRule(slideNo: string, reason: string) {
    this.rejectRules.set(slideNo, reason);
  }

  clearRejectRule(slideNo: string) {
    this.rejectRules.delete(slideNo);
  }

  getOccupant(slideNo: string): OccupantInfo | undefined {
    const hit = this.registry.get(slideNo);
    if (!hit) return undefined;
    return {
      holderRecordId: hit.recordId,
      holderLabRef: hit.labRef,
      holderSampleName: hit.sampleName,
      receivedAt: hit.receivedAt,
    };
  }

  private makeReceipt(p: CentralSubmitPayload, accepted: boolean, rejectReason?: string): LabReceipt {
    if (accepted) {
      this.receiptSeq += 1;
    }
    const no = accepted
      ? `LAB-RCV-${this.now().toString(36).toUpperCase()}-${String(this.receiptSeq).padStart(3, "0")}`
      : `LAB-RJT-${this.now().toString(36).toUpperCase()}-${String(this.receiptSeq + 1).padStart(3, "0")}`;
    return {
      receiptNo: no,
      slideNo: p.slideNo,
      sampleName: p.sampleName,
      stainBatchName: p.stainBatchName,
      status: accepted ? "accepted" : "rejected",
      rejectReason,
      receivedAt: this.now(),
    };
  }

  async submit(p: CentralSubmitPayload): Promise<SubmitResult> {
    // 模拟往返延迟
    await new Promise((res) => setTimeout(res, 260 + Math.random() * 260));

    if (!this.online || this.fault.kind === "offline") {
      return { outcome: "network_error", slideNo: p.slideNo, message: "链路离线，中心实验室不可达" };
    }
    if (
      (this.fault.kind === "dropOnce" || this.fault.kind === "drop") &&
      this.fault.recordId === p.recordId
    ) {
      const once = this.fault.kind === "dropOnce";
      if (once) this.fault = { kind: "none" };
      if (once) {
        // 中心已原子落库，但响应回程丢失：登记册保留，重试时幂等重放，不重复建档
        const receipt = this.makeReceipt(p, true);
        this.registry.set(p.slideNo, {
          recordId: p.recordId,
          labRef: receipt.receiptNo,
          sampleName: p.sampleName,
          receivedAt: receipt.receivedAt,
        });
        this.acceptedEcho.set(p.slideNo, receipt);
      }
      return { outcome: "network_error", slideNo: p.slideNo, message: "写入响应丢失（TCP 中断）" };
    }

    // 1) 幂等：同一记录此前已成功写入，直接重放原回执（不重复建档）
    const existing = this.acceptedEcho.get(p.slideNo);
    if (existing && this.registry.get(p.slideNo)?.recordId === p.recordId) {
      return { outcome: "accepted", receipt: existing, idempotentReplay: true };
    }

    // 2) 原子占用检查：编号已被别的玻片占用
    const occupant = this.registry.get(p.slideNo);
    if (occupant && occupant.recordId !== p.recordId) {
      return {
        outcome: "occupied",
        slideNo: p.slideNo,
        occupant: {
          holderRecordId: occupant.recordId,
          holderLabRef: occupant.labRef,
          holderSampleName: occupant.sampleName,
          receivedAt: occupant.receivedAt,
        },
      };
    }

    // 3) 拒收规则（样本不合格 / 玻片破损等，由中心判定）
    const rejectReason = this.rejectRules.get(p.slideNo);
    if (rejectReason) {
      return { outcome: "rejected", receipt: this.makeReceipt(p, false, rejectReason) };
    }

    // 4) 接收并占用编号（原子写）
    const receipt = this.makeReceipt(p, true);
    this.registry.set(p.slideNo, {
      recordId: p.recordId,
      labRef: receipt.receiptNo,
      sampleName: p.sampleName,
      receivedAt: receipt.receivedAt,
    });
    this.acceptedEcho.set(p.slideNo, receipt);
    return { outcome: "accepted", receipt, idempotentReplay: false };
  }
}
