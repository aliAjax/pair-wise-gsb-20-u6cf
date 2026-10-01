import type { CentralReceipt, ServerClaim, ServerState } from "./types";

export class CentralError extends Error {
  constructor(
    message: string,
    /** 网络层失败（可重试）；false 表示业务应答明确（占用/拒收），不应盲目重试 */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CentralError";
  }
}

/**
 * 中心实验室客户端。
 *
 * 对接真实系统时把两个方法换成 fetch 即可，行为契约保持不变：
 * - claimSlide：同一 slideNo 只放行一条提交；已被他人占用时抛出
 *   kind=occupied（不可重试）。
 * - fetchReceipt：按 slideNo 拉取接收回执；网络故障抛 retryable 错误。
 *
 * 本地实现把中心状态存在服务端存储里（演示为 IndexedDB 的 server 桶，
 * 可通过“中心实验室回执台”维护），并支持用 failNext 模拟写入中断：
 * 每次网络故障只发生在指定阶段一次，重放时已完成的阶段不会再执行。
 */
export interface CentralClient {
  claimSlide(req: {
    slideNo: string;
    recordId: string;
    microscopist: string;
  }): Promise<{ ok: true; claim: ServerClaim } | { ok: false; conflict: ServerClaim }>;
  fetchReceipt(slideNo: string): Promise<CentralReceipt | undefined>;
  /** 测试/演示：下一次对该 slideNo 的指定阶段注入一次可重试故障 */
  failOnce(slideNo: string, stage: "claim" | "receipt"): void;
}

export class LocalCentralClient implements CentralClient {
  private faults = new Map<string, Set<"claim" | "receipt">>();

  constructor(
    private readonly load: () => Promise<ServerState>,
    private readonly save: (state: ServerState) => Promise<void>,
  ) {}

  failOnce(slideNo: string, stage: "claim" | "receipt") {
    const set = this.faults.get(slideNo) ?? new Set<"claim" | "receipt">();
    set.add(stage);
    this.faults.set(slideNo, set);
  }

  private consumeFault(slideNo: string, stage: "claim" | "receipt") {
    const set = this.faults.get(slideNo);
    if (set?.has(stage)) {
      set.delete(stage);
      if (set.size === 0) this.faults.delete(slideNo);
      throw new CentralError(`中心连接中断（${stage} 阶段写入失败，可重试）`, true);
    }
  }

  async claimSlide(req: {
    slideNo: string;
    recordId: string;
    microscopist: string;
  }): Promise<{ ok: true; claim: ServerClaim } | { ok: false; conflict: ServerClaim }> {
    this.consumeFault(req.slideNo, "claim");
    const state = await this.load();
    const existing = state.claims[req.slideNo];
    if (existing && existing.recordId !== req.recordId) {
      return { ok: false, conflict: existing };
    }
    const claim: ServerClaim = existing ?? {
      slideNo: req.slideNo,
      recordId: req.recordId,
      microscopist: req.microscopist,
      claimedAt: Date.now(),
    };
    state.claims[req.slideNo] = claim;
    await this.save(state);
    return { ok: true, claim };
  }

  async fetchReceipt(slideNo: string): Promise<CentralReceipt | undefined> {
    this.consumeFault(slideNo, "receipt");
    const state = await this.load();
    return state.receipts[slideNo];
  }
}
