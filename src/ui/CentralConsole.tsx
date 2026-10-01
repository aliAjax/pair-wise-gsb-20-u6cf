import { useEffect, useState } from "react";
import type { Workspace } from "../data/useAcceptance";
import type { CentralReceipt } from "../domain/types";
import { fmtFull } from "./labels";

export function CentralConsole({
  ws,
  onUpsertReceipt,
  onReleaseClaim,
}: {
  ws: Workspace;
  onUpsertReceipt: (receipt: CentralReceipt) => void;
  onReleaseClaim: (slideNo: string) => void;
}) {
  const slideNos = Array.from(
    new Set([...ws.samples.map((s) => s.slideNo), ...Object.keys(ws.server.receipts)]),
  ).sort();
  const firstSample = ws.samples.find((s) => s.slideNo === slideNos[0]);
  const firstStain = ws.stains.find((b) => b.id === firstSample?.stainBatchId);
  const firstReceipt = slideNos[0] ? ws.server.receipts[slideNos[0]] : undefined;
  const [slideNo, setSlideNo] = useState(slideNos[0] ?? "");
  const sample = ws.samples.find((s) => s.slideNo === slideNo);
  const stain = ws.stains.find((b) => b.id === sample?.stainBatchId);
  const existing = ws.server.receipts[slideNo];

  const [accepted, setAccepted] = useState(firstReceipt?.accepted ?? true);
  const [fingerprint, setFingerprint] = useState(
    firstReceipt?.sampleFingerprint ?? firstSample?.fingerprint ?? "",
  );
  const [stainCode, setStainCode] = useState(
    firstReceipt?.stainBatchCode ?? firstStain?.code ?? "",
  );
  const [note, setNote] = useState(firstReceipt?.note ?? "");

  // 数据首次加载或当前选中项消失时，默认选第一张玻片并预填双方值
  useEffect(() => {
    if (slideNos.includes(slideNo)) return;
    const no = slideNos[0];
    if (no) selectSlide(no);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideNos.join(",")]);

  const selectSlide = (no: string) => {
    setSlideNo(no);
    const r = ws.server.receipts[no];
    const smp = ws.samples.find((s) => s.slideNo === no);
    const stb = ws.stains.find((b) => b.id === smp?.stainBatchId);
    setAccepted(r?.accepted ?? true);
    setFingerprint(r?.sampleFingerprint ?? smp?.fingerprint ?? "");
    setStainCode(r?.stainBatchCode ?? stb?.code ?? "");
    setNote(r?.note ?? "");
  };

  const save = () => {
    if (!slideNo) return;
    onUpsertReceipt({
      id: existing?.id ?? `RC-${Math.floor(8000 + Math.random() * 1999)}`,
      slideNo,
      accepted,
      sampleFingerprint: fingerprint,
      stainBatchCode: stainCode,
      receivedAt: Date.now(),
      note: note || undefined,
    });
  };

  return (
    <div className="central-console">
      <h3>中心实验室回执台</h3>
      <p className="panel-hint">
        模拟中心实验室侧：登记/更正某玻片编号的接收回执，释放编号占用。镜检端只可读取核对，不能改写中心值。
      </p>

      <div className="claim-list">
        <h4>编号占用仲裁（{Object.keys(ws.server.claims).length}）</h4>
        {Object.keys(ws.server.claims).length === 0 && <p className="empty">暂无占用</p>}
        {Object.values(ws.server.claims).map((c) => (
          <div className="claim-row" key={c.slideNo}>
            <span>
              <strong>{c.slideNo}</strong> ← {c.microscopist}（记录 {c.recordId.slice(-6)}）
            </span>
            <button onClick={() => onReleaseClaim(c.slideNo)}>释放占用</button>
          </div>
        ))}
      </div>

      <h4>登记 / 更正回执</h4>
      <div className="receipt-form">
        <label>
          <span>玻片编号</span>
          <select value={slideNo} onChange={(e) => selectSlide(e.target.value)}>
            {slideNos.map((no) => (
              <option key={no}>{no}</option>
            ))}
          </select>
        </label>
        <label>
          <span>中心结论</span>
          <select
            value={accepted ? "1" : "0"}
            onChange={(e) => setAccepted(e.target.value === "1")}
          >
            <option value="1">接收</option>
            <option value="0">拒收</option>
          </select>
        </label>
        <label className="span-2">
          <span>
            回传样本指纹
            {sample && (
              <button
                type="button"
                className="link-btn"
                onClick={() => setFingerprint(sample.fingerprint)}
              >
                填入本地值
              </button>
            )}
          </span>
          <input value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} />
        </label>
        <label>
          <span>
            回传染色批次
            {stain && (
              <button type="button" className="link-btn" onClick={() => setStainCode(stain.code)}>
                填入本地值
              </button>
            )}
          </span>
          <input value={stainCode} onChange={(e) => setStainCode(e.target.value)} />
        </label>
        <label>
          <span>备注</span>
          <input value={note} placeholder={accepted ? "" : "如 玻片运输破损"} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="form-actions">
          <button className="primary-action" onClick={save}>
            {existing ? "更正回执" : "下发回执"}
          </button>
        </div>
      </div>

      <h4>已下发回执（{Object.values(ws.server.receipts).length}）</h4>
      <div className="receipt-list">
        {Object.values(ws.server.receipts)
          .sort((a, b) => b.receivedAt - a.receivedAt)
          .map((r) => (
            <div className={`receipt-row ${r.accepted ? "" : "rejected"}`} key={r.id}>
              <span className={`badge ${r.accepted ? "badge-green" : "badge-red"}`}>
                {r.accepted ? "接收" : "拒收"}
              </span>
              <strong>{r.slideNo}</strong>
              <span>{r.id}</span>
              <span>{r.stainBatchCode}</span>
              <span className="muted">{fmtFull(r.receivedAt)}</span>
              {r.note && <span className="note"> {r.note}</span>}
            </div>
          ))}
      </div>
    </div>
  );
}
