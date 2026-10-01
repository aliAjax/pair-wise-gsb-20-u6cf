import { useEffect, useState } from "react";
import { sampleFingerprint } from "../domain/engine";
import type { ScaleVersion, StainBatch } from "../domain/types";

export interface NewEntry {
  slideNo: string;
  name: string;
  specimenType: string;
  stainBatchId: string;
  collector: string;
  collectedAt: number;
  microscopist: string;
  magnification: string;
  structures: string;
  description: string;
  scaleVersionId: string;
  measurements: { feature: string; pixels: number }[];
  queueNow: boolean;
}

const SPECIMEN_TYPES = ["植物组织", "动物组织", "微生物", "血液涂片"];
const MAGNIFICATIONS = ["100x", "200x", "400x", "1000x"];

export function OfflineEntryForm({
  stains,
  scales,
  disabled,
  onSubmit,
}: {
  stains: StainBatch[];
  scales: ScaleVersion[];
  disabled: boolean;
  onSubmit: (entry: NewEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const todayInput = new Date();
  todayInput.setMinutes(todayInput.getMinutes() - todayInput.getTimezoneOffset());
  const [collectedDate, setCollectedDate] = useState(todayInput.toISOString().slice(0, 10));
  const [form, setForm] = useState({
    slideNo: "",
    name: "",
    specimenType: SPECIMEN_TYPES[0],
    stainBatchId: stains[0]?.id ?? "",
    collector: "",
    microscopist: "",
    magnification: "400x",
    structures: "",
    description: "",
    scaleVersionId: scales[0]?.id ?? "",
    queueNow: false,
  });
  const [measurements, setMeasurements] = useState([{ feature: "", pixels: "" }]);

  useEffect(() => {
    setForm((f) => ({
      ...f,
      stainBatchId: f.stainBatchId || stains[0]?.id || "",
      scaleVersionId: f.scaleVersionId || scales[0]?.id || "",
    }));
  }, [stains, scales]);

  if (!open) {
    return (
      <button className="primary-action wide" onClick={() => setOpen(true)} disabled={disabled}>
        + 离线补录玻片观察
      </button>
    );
  }

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const stain = stains.find((s) => s.id === form.stainBatchId);
  const scale = scales.find((s) => s.id === form.scaleVersionId);

  const submit = () => {
    if (!form.slideNo.trim() || !form.microscopist.trim()) return;
    onSubmit({
      ...form,
      collectedAt: new Date(collectedDate + "T09:00").getTime(),
      measurements: measurements
        .filter((m) => m.feature.trim())
        .map((m) => ({ feature: m.feature.trim(), pixels: Number(m.pixels) || 0 })),
    });
    setOpen(false);
  };

  return (
    <div className="form-card">
      <div className="section-heading">
        <div>
          <p>离线补录</p>
          <h3>登记样本与观察记录</h3>
        </div>
        <button onClick={() => setOpen(false)}>收起</button>
      </div>
      <div className="field-grid">
        <label>
          <span>玻片编号 *</span>
          <input
            value={form.slideNo}
            placeholder="如 BP-1006"
            onChange={(e) => set({ slideNo: e.target.value })}
          />
        </label>
        <label>
          <span>样本名称</span>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          <span>样本类型</span>
          <select
            value={form.specimenType}
            onChange={(e) => set({ specimenType: e.target.value })}
          >
            {SPECIMEN_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <span>采样日期</span>
          <input
            type="date"
            value={collectedDate}
            onChange={(e) => setCollectedDate(e.target.value)}
          />
        </label>
        <label>
          <span>采样人</span>
          <input value={form.collector} onChange={(e) => set({ collector: e.target.value })} />
        </label>
        <label>
          <span>染色批次</span>
          <select
            value={form.stainBatchId}
            onChange={(e) => set({ stainBatchId: e.target.value })}
          >
            {stains.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.method}（v{b.version}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>镜检员 *</span>
          <input
            value={form.microscopist}
            placeholder="如 陈镜检"
            onChange={(e) => set({ microscopist: e.target.value })}
          />
        </label>
        <label>
          <span>放大倍数</span>
          <select
            value={form.magnification}
            onChange={(e) => set({ magnification: e.target.value })}
          >
            {MAGNIFICATIONS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          <span>标尺版本（测量换算依据）</span>
          <select
            value={form.scaleVersionId}
            onChange={(e) => set({ scaleVersionId: e.target.value })}
          >
            {scales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.scope} · {s.umPerPixel} μm/px（v{s.version}）
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          <span>观察结构</span>
          <input value={form.structures} onChange={(e) => set({ structures: e.target.value })} />
        </label>
        <label className="span-2">
          <span>视野描述</span>
          <input
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
      </div>

      <div className="measure-head">
        <span>测量（像素 → 按标尺换算 μm）</span>
        <button
          type="button"
          onClick={() => setMeasurements((ms) => [...ms, { feature: "", pixels: "" }])}
        >
          + 增加测量项
        </button>
      </div>
      <div className="measure-rows">
        {measurements.map((m, i) => (
          <div className="measure-row" key={i}>
            <input
              placeholder="结构，如 细胞核直径"
              value={m.feature}
              onChange={(e) =>
                setMeasurements((ms) =>
                  ms.map((x, j) => (j === i ? { ...x, feature: e.target.value } : x)),
                )
              }
            />
            <input
              placeholder="像素尺寸"
              inputMode="decimal"
              value={m.pixels}
              onChange={(e) =>
                setMeasurements((ms) =>
                  ms.map((x, j) => (j === i ? { ...x, pixels: e.target.value } : x)),
                )
              }
            />
            {scale && Number(m.pixels) > 0 && (
              <em>= {Math.round(Number(m.pixels) * scale.umPerPixel * 1000) / 1000} μm</em>
            )}
          </div>
        ))}
      </div>

      {stain && (
        <p className="fp-preview">
          核对指纹（本地）：
          <code>
            {sampleFingerprint({
              stainBatchCode: stain.code,
              specimenType: form.specimenType,
              collectedAt: new Date(collectedDate + "T09:00").getTime(),
            })}
          </code>
        </p>
      )}

      <label className="inline-check">
        <input
          type="checkbox"
          checked={form.queueNow}
          onChange={(e) => set({ queueNow: e.target.checked })}
        />
        保存后立即加入发送队列（当前离线则回网后自动可发）
      </label>
      <div className="form-actions">
        <button className="primary-action" onClick={submit} disabled={disabled}>
          保存观察记录
        </button>
      </div>
    </div>
  );
}
