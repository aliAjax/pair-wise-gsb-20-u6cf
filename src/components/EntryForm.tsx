import { useState } from "react";
import { useStore } from "../state/store";

export function EntryForm() {
  const { state, addRecord } = useStore();
  const [slideNo, setSlideNo] = useState("");
  const [sampleId, setSampleId] = useState(state.samples[0]?.id ?? "");
  const [scaleId, setScaleId] = useState(state.scales[0]?.id ?? "");
  const [magnification, setMagnification] = useState("400x");
  const [rawPixels, setRawPixels] = useState(200);
  const [structure, setStructure] = useState("");
  const [description, setDescription] = useState("");
  const [microscopist, setMicroscopist] = useState("王镜检");

  const submit = () => {
    if (!slideNo.trim()) return;
    addRecord({
      slideNo,
      sampleId: sampleId || state.samples[0].id,
      scaleId: scaleId || state.scales[0].id,
      magnification,
      rawPixels: Number(rawPixels) || 0,
      structure,
      description,
      microscopist,
    });
    setSlideNo("");
    setStructure("");
    setDescription("");
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>镜检补录{state.online ? "" : " · 离线模式（只写本地 IndexedDB）"}</p>
          <h2>观察记录录入</h2>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>玻片编号 *</span>
          <input
            placeholder="如 SL-2026-1010"
            value={slideNo}
            onChange={(e) => setSlideNo(e.target.value)}
          />
        </label>
        <label>
          <span>镜检员</span>
          <input value={microscopist} onChange={(e) => setMicroscopist(e.target.value)} />
        </label>
        <label>
          <span>样本</span>
          <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
            {state.samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s.type}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>标尺版本</span>
          <select value={scaleId} onChange={(e) => setScaleId(e.target.value)}>
            {state.scales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} v{s.version}（{s.micronsPerPixel} μm/px）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>放大倍数</span>
          <input value={magnification} onChange={(e) => setMagnification(e.target.value)} />
        </label>
        <label>
          <span>目标结构 / 像素长度</span>
          <div className="inline-inputs">
            <input
              placeholder="如 细胞核长径"
              value={structure}
              onChange={(e) => setStructure(e.target.value)}
            />
            <input
              type="number"
              min={0}
              style={{ maxWidth: 110 }}
              value={rawPixels}
              onChange={(e) => setRawPixels(Number(e.target.value))}
            />
          </div>
        </label>
        <label className="full-span">
          <span>视野描述</span>
          <input
            placeholder="记录细胞壁、细胞核、分布等观察结果"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
      <div className="form-foot">
        <button className="primary-action" onClick={submit} disabled={!slideNo.trim()}>
          {state.online ? "保存并入同步队列" : "离线保存到本地"}
        </button>
        <span className="hint">
          测量结论按当前染色批次与标尺版本当场计算；依赖版本更新后会自动标记失效待重算
        </span>
      </div>
    </section>
  );
}
