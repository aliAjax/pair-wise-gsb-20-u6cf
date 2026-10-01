import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AcceptedSnapshot,
  AppState,
  ObservationRecord,
} from "../types";
import {
  appendLog,
  applySubmitResult,
  canAccept,
  computeMeasurement,
  createSnapshot,
  lockIntoSnapshot,
  markStaleForDeps,
  markSubmitting,
  queueRecord,
  recomputeMeasurement,
  selectPending,
  uid,
} from "../domain/engine";
import { createSeedState, PRE_OCCUPIED_SLIDE } from "../domain/seed";
import { CentralLabService } from "../services/centralLab";
import { clearState, loadState, saveState } from "../services/storage";

type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "setOnline"; online: boolean }
  | {
      type: "addRecord";
      record: ObservationRecord;
      offline: boolean;
      at: number;
    }
  | { type: "updateRecord"; record: ObservationRecord }
  | { type: "replaceRecords"; records: ObservationRecord[] }
  | { type: "addSnapshot"; snapshot: AcceptedSnapshot; record: ObservationRecord; at: number }
  | { type: "addLog"; kind: AppState["logs"][number]["kind"]; message: string; at: number }
  | { type: "bumpStain"; batchId: string; at: number }
  | { type: "bumpScale"; scaleId: string; at: number }
  | { type: "reset"; state: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
    case "reset":
      return action.state;
    case "setOnline":
      return { ...state, online: action.online };
    case "addRecord": {
      const prefix = action.offline ? "离线补录：" : "";
      const suffix = action.offline ? "，已存本地，回网后按玻片编号核对中心回执" : "，已加入同步队列";
      return {
        ...state,
        records: [action.record, ...state.records],
        logs: [
          {
            id: uid("log"),
            at: action.at,
            kind: "info" as const,
            message:
              prefix +
              `镜检员 ${action.record.microscopist} 保存玻片 ${action.record.slideNo} 的观察记录` +
              suffix,
          },
          ...state.logs,
        ].slice(0, 80),
      };
    }
    case "updateRecord":
      return {
        ...state,
        records: state.records.map((r) => (r.id === action.record.id ? action.record : r)),
      };
    case "replaceRecords":
      return { ...state, records: action.records };
    case "addSnapshot":
      return {
        ...state,
        snapshots: [action.snapshot, ...state.snapshots],
        records: state.records.map((r) => (r.id === action.record.id ? action.record : r)),
      };
    case "addLog":
      return appendLog(state, action.kind, action.message, action.at);
    case "bumpStain": {
      const batches = state.stainBatches.map((b) =>
        b.id === action.batchId ? { ...b, version: b.version + 1 } : b
      );
      const records = markStaleForDeps(state.records, { stainBatchId: action.batchId });
      const name = state.stainBatches.find((b) => b.id === action.batchId)?.name ?? action.batchId;
      const next: AppState = { ...state, stainBatches: batches, records };
      return appendLog(
        next,
        "warn",
        `染色批次「${name}」发布新版本，依赖它的测量结论全部失效、等待重算；未重算的不得进入已验收快照`,
        action.at
      );
    }
    case "bumpScale": {
      const scales = state.scales.map((s) =>
        s.id === action.scaleId ? { ...s, version: s.version + 1 } : s
      );
      const records = markStaleForDeps(state.records, { scaleId: action.scaleId });
      const name = state.scales.find((s) => s.id === action.scaleId)?.name ?? action.scaleId;
      const next: AppState = { ...state, scales, records };
      return appendLog(
        next,
        "warn",
        `标尺「${name}」重新标定并升版，引用该标尺的测量结论全部失效、等待重算`,
        action.at
      );
    }
  }
}

export interface NewRecordInput {
  slideNo: string;
  sampleId: string;
  scaleId: string;
  magnification: string;
  rawPixels: number;
  structure: string;
  description: string;
  microscopist: string;
}

interface StoreApi {
  state: AppState;
  central: CentralLabService;
  syncing: boolean;
  addRecord: (input: NewRecordInput) => ObservationRecord;
  runSync: () => Promise<void>;
  bumpStain: (batchId: string) => void;
  bumpScale: (scaleId: string) => void;
  recompute: (recordId: string) => void;
  acceptSnapshot: (recordId: string) => void;
  correctRecord: (
    recordId: string,
    patch: Partial<Pick<ObservationRecord, "slideNo" | "sampleName" | "stainBatchName">>
  ) => void;
  retryRecord: (recordId: string) => void;
  demoConcurrent: () => Promise<void>;
  demoInterruption: () => void;
  setOnline: (online: boolean) => void;
  resetAll: () => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => createSeedState());
  const [syncing, setSyncing] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const syncingRef = useRef(false);

  const centralRef = useRef<CentralLabService | null>(null);
  if (!centralRef.current) {
    const svc = new CentralLabService();
    svc.seedRegistry([
      {
        slideNo: PRE_OCCUPIED_SLIDE,
        occupant: {
          holderRecordId: "ext-4471",
          holderLabRef: "LAB-RCV-20250921-0312",
          holderSampleName: "蚕豆叶表皮（外校送检）",
        },
      },
    ]);
    svc.setRejectRule("SL-2026-0900", "玻片碎裂、标本干涸，无法镜检");
    centralRef.current = svc;
  }
  const central = centralRef.current;

  const hydratedRef = useRef(false);

  // 启动时从 IndexedDB 恢复（写入中断后已完成条目仍在本地）
  useEffect(() => {
    let alive = true;
    loadState()
      .then((saved) => {
        if (!alive || !saved) return;
        // 崩溃恢复：残留 submitting 视为未完成，回到 write_failed 等待只重试未完成部分
        const recovered: AppState = {
          ...saved,
          online: saved.online ?? true,
          records: saved.records.map((r) =>
            r.state === "submitting"
              ? {
                  ...r,
                  state: "write_failed",
                  queued: true,
                  lastError: "上次写入中断，恢复待重试",
                }
              : r
          ),
        };
        dispatch({ type: "hydrate", state: recovered });
        if (recovered.records.some((r) => r.state === "write_failed")) {
          dispatch({
            type: "addLog",
            kind: "info",
            message: "检测到上次写入中断：已完成条目保留原状，未完成条目重新排队，仅重试未完成部分",
            at: Date.now(),
          });
        }
      })
      .finally(() => {
        hydratedRef.current = true;
      });
    return () => {
      alive = false;
    };
  }, []);

  // 状态变化即持久化（同步循环中还会逐条显式落库，保证中断粒度）
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveState(state).catch(() => undefined);
  }, [state]);

  const addRecord = useCallback((input: NewRecordInput): ObservationRecord => {
    const s = stateRef.current;
    const sample = s.samples.find((x) => x.id === input.sampleId) ?? s.samples[0];
    const batch = s.stainBatches.find((b) => b.id === sample.stainBatchId) ?? s.stainBatches[0];
    const scale = s.scales.find((x) => x.id === input.scaleId) ?? s.scales[0];
    const now = Date.now();
    const rec: ObservationRecord = {
      id: uid("rec"),
      slideNo: input.slideNo.trim(),
      sampleId: sample.id,
      sampleName: sample.name,
      stainBatchId: batch.id,
      stainBatchName: batch.name,
      scaleId: scale.id,
      magnification: input.magnification,
      description: input.description,
      microscopist: input.microscopist.trim() || "未署名镜检员",
      createdAt: now,
      updatedAt: now,
      state: "draft",
      queued: true,
      attempts: 0,
      measurement: computeMeasurement(
        { slideNo: input.slideNo, sampleName: sample.name },
        input.rawPixels,
        input.structure.trim() || "目标结构",
        batch,
        scale,
        now
      ),
    };
    dispatch({ type: "addRecord", record: rec, offline: !s.online, at: now });
    return rec;
  }, []);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    if (!stateRef.current.online) {
      dispatch({
        type: "addLog",
        kind: "info",
        message: "当前处于离线状态：观察记录保留在本地，回网后再核对中心回执",
        at: Date.now(),
      });
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    // 循环内维护即时更新的工作集：不依赖 reducer 的渲染时机，
    // 避免批量更新窗口内 stateRef 仍旧导致同一条被重复处理
    let working = stateRef.current.records;
    try {
      // 顺序同步：每完成一条立即落库；中断时前面已完成的条目不丢、不重复
      while (true) {
        const pending = selectPending(working);
        if (pending.length === 0) break;
        const rec = pending[0];
        const submitting = markSubmitting(rec);
        working = working.map((r) => (r.id === rec.id ? submitting : r));
        dispatch({ type: "replaceRecords", records: working });
        await new Promise((r) => setTimeout(r, 30)); // 让 submitting 先渲染并落库

        const result = await central.submit({
          recordId: rec.id,
          slideNo: rec.slideNo,
          sampleName: rec.sampleName,
          stainBatchName: rec.stainBatchName,
          microscopist: rec.microscopist,
        });

        const applied = applySubmitResult(rec, result);
        working = working.map((r) => (r.id === rec.id ? applied.record : r));
        // 用本轮工作集更新 reducer 并逐条立即落库，
        // 写入中断后只重试仍未完成的部分，已完成条目不重放
        dispatch({ type: "replaceRecords", records: working });
        dispatch({
          type: "addLog",
          kind: applied.level,
          message: applied.message,
          at: Date.now(),
        });
        await new Promise((r) => setTimeout(r, 0)); // 让上面的 dispatch 合并进 stateRef
        await saveState({
          ...stateRef.current,
          records: working,
        }).catch(() => undefined);

        if (applied.record.state === "write_failed") {
          dispatch({
            type: "addLog",
            kind: "info",
            message: `同步在玻片 ${rec.slideNo} 处暂停，后续条目保持排队，待重试`,
            at: Date.now(),
          });
          break;
        }
      }
      const left = selectPending(working).length;
      dispatch({
        type: "addLog",
        kind: left === 0 ? "success" : "info",
        message:
          left === 0
            ? "同步队列已清空：回执核对通过的进入已核对，拒收/占用/字段不符的停在待核区"
            : `本轮同步结束，仍有 ${left} 条未完成，仅这些条目会在下次重试`,
        at: Date.now(),
      });
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [central]);

  const bumpStain = useCallback((batchId: string) => {
    dispatch({ type: "bumpStain", batchId, at: Date.now() });
  }, []);

  const bumpScale = useCallback((scaleId: string) => {
    dispatch({ type: "bumpScale", scaleId, at: Date.now() });
  }, []);

  const recompute = useCallback((recordId: string) => {
    const s = stateRef.current;
    const rec = s.records.find((r) => r.id === recordId);
    if (!rec || !rec.measurement) return;
    const batch = s.stainBatches.find((b) => b.id === rec.stainBatchId);
    const scale = s.scales.find((x) => x.id === rec.scaleId);
    if (!batch || !scale) return;
    const updated = recomputeMeasurement(rec, batch, scale);
    dispatch({ type: "updateRecord", record: updated });
    dispatch({
      type: "addLog",
      kind: "success",
      message: `玻片 ${rec.slideNo} 已按 ${batch.name} v${batch.version}、${scale.name} v${scale.version} 重算测量结论`,
      at: Date.now(),
    });
  }, []);

  const acceptSnapshot = useCallback((recordId: string) => {
    const s = stateRef.current;
    const rec = s.records.find((r) => r.id === recordId);
    if (!rec || !canAccept(rec)) return;
    const scale = s.scales.find((x) => x.id === rec.scaleId);
    const snap = createSnapshot(rec, scale?.name ?? rec.scaleId);
    const locked = lockIntoSnapshot(rec, snap.id);
    dispatch({ type: "addSnapshot", snapshot: snap, record: locked, at: Date.now() });
    dispatch({
      type: "addLog",
      kind: "success",
      message: `玻片 ${rec.slideNo} 进入已验收快照 ${snap.id}（回执 ${snap.receiptNo}，结论版本已固化，快照不可变）`,
      at: Date.now(),
    });
  }, []);

  const correctRecord = useCallback(
    (
      recordId: string,
      patch: Partial<Pick<ObservationRecord, "slideNo" | "sampleName" | "stainBatchName">>
    ) => {
      const s = stateRef.current;
      const rec = s.records.find((r) => r.id === recordId);
      if (!rec || rec.state !== "pending_check") return;
      const corrected: ObservationRecord = {
        ...rec,
        ...patch,
        state: "draft",
        queued: true,
        receipt: undefined,
        discrepancies: undefined,
        rejectReason: undefined,
        occupant: undefined,
        updatedAt: Date.now(),
      };
      dispatch({ type: "updateRecord", record: corrected });
      dispatch({
        type: "addLog",
        kind: "info",
        message: `玻片 ${rec.slideNo} 的待核信息已更正并重新排队，回网后按新玻片编号重新核对回执`,
        at: Date.now(),
      });
    },
    []
  );

  const retryRecord = useCallback((recordId: string) => {
    const s = stateRef.current;
    const rec = s.records.find((r) => r.id === recordId);
    if (!rec) return;
    dispatch({
      type: "updateRecord",
      record: queueRecord({ ...rec, lastError: undefined }, true),
    });
    dispatch({
      type: "addLog",
      kind: "info",
      message: `玻片 ${rec.slideNo} 已重新加入同步队列，仅重试该未完成条目`,
      at: Date.now(),
    });
  }, []);

  // 两名镜检员同时提交同一玻片编号：中心原子占位只放行一条，另一条停待核区
  const demoConcurrent = useCallback(async () => {
    if (syncingRef.current || !stateRef.current.online) return;
    const s = stateRef.current;
    const batch = s.stainBatches[0];
    const scale = s.scales[0];
    const now = Date.now();
    const slideNo = `SL-CONC-${Math.floor(1000 + Math.random() * 9000)}`;
    const mkConcurrentRec = (
      id: string,
      who: string,
      sampleName: string,
      delayMs: number
    ): ObservationRecord => ({
      id,
      slideNo,
      sampleId: `smp-${id}`,
      sampleName,
      stainBatchId: batch.id,
      stainBatchName: batch.name,
      scaleId: scale.id,
      magnification: "400x",
      description: `两名镜检员同时提交编号 ${slideNo}（${who}）`,
      microscopist: who,
      createdAt: now + delayMs,
      updatedAt: now + delayMs,
      state: "submitting",
      queued: false,
      attempts: 0,
      measurement: computeMeasurement(
        { slideNo, sampleName },
        205,
        "并发演示目标结构",
        batch,
        scale,
        now
      ),
    });
    const recA = mkConcurrentRec(uid("rec"), "王镜检（甲机）", "洋葱表皮（甲机）", 0);
    const recB = mkConcurrentRec(uid("rec"), "李镜检（乙机）", "洋葱表皮（乙机）", 1);

    syncingRef.current = true;
    setSyncing(true);
    try {
      const [resA, resB] = await Promise.all([
        central.submit({
          recordId: recA.id,
          slideNo,
          sampleName: recA.sampleName,
          stainBatchName: recA.stainBatchName,
          microscopist: recA.microscopist,
        }),
        central.submit({
          recordId: recB.id,
          slideNo,
          sampleName: recB.sampleName,
          stainBatchName: recB.stainBatchName,
          microscopist: recB.microscopist,
        }),
      ]);
      const outA = applySubmitResult(recA, resA);
      const outB = applySubmitResult(recB, resB);
      const nextRecords = [outA.record, outB.record, ...stateRef.current.records];
      const nextState = { ...stateRef.current, records: nextRecords };
      await saveState(nextState).catch(() => undefined);
      dispatch({ type: "hydrate", state: nextState });
      dispatch({
        type: "addLog",
        kind: "warn",
        message: `同一玻片编号 ${slideNo} 并发提交：中心只放行一条（${
          outA.record.state === "verified" ? "甲机" : "乙机"
        } 已核对），另一条因编号被占用停在待核区`,
        at: Date.now(),
      });
      for (const out of [outA, outB]) {
        dispatch({
          type: "addLog",
          kind: out.record.state === "verified" ? "success" : out.level,
          message: out.message,
          at: Date.now(),
        });
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [central]);

  // 注入"中心已落库、响应丢失"：已完成条目不重跑，本条重试幂等重放
  const demoInterruption = useCallback(() => {
    const target = selectPending(stateRef.current.records)[0];
    if (!target) return;
    central.fault = { kind: "dropOnce", recordId: target.id };
    dispatch({
      type: "addLog",
      kind: "danger",
      message: `已对玻片 ${target.slideNo} 注入写入中断（中心落库成功、响应回程丢失），观察已完成条目是否保留`,
      at: Date.now(),
    });
    void runSync();
  }, [central, runSync]);

  const setOnline = useCallback(
    (online: boolean) => {
      central.online = online;
      dispatch({ type: "setOnline", online });
      dispatch({
        type: "addLog",
        kind: online ? "success" : "warn",
        message: online
          ? "网络已恢复：可按玻片编号核对中心回执"
          : "网络已断开：进入离线补录模式，数据只写本地",
        at: Date.now(),
      });
    },
    [central]
  );

  const resetAll = useCallback(async () => {
    await clearState();
    dispatch({ type: "reset", state: createSeedState() });
  }, []);

  const value = useMemo<StoreApi>(
    () => ({
      state,
      central,
      syncing,
      addRecord,
      runSync,
      bumpStain,
      bumpScale,
      recompute,
      acceptSnapshot,
      correctRecord,
      retryRecord,
      demoConcurrent,
      demoInterruption,
      setOnline,
      resetAll,
    }),
    [
      state,
      central,
      syncing,
      addRecord,
      runSync,
      bumpStain,
      bumpScale,
      recompute,
      acceptSnapshot,
      correctRecord,
      retryRecord,
      demoConcurrent,
      demoInterruption,
      setOnline,
      resetAll,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
