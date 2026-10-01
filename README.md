# hxwl-06 显微镜玻片观察 · 可追溯验收流程

样本 → 观察记录 → 中心实验室回执核对 → 待核/验收 → 已验收快照 的闭环，支持镜检员离线补录与回网断点续传。

## 技术栈

React 19 + Vite + TypeScript + IndexedDB（无后端；中心实验室侧以本地回执台模拟，可替换为真实 API）

## 本地运行

```bash
npm install
npm run dev      # 开发端口 5106
npm test         # 验收流程逻辑测试（node:test，内存存储）
npm run build    # tsc 类型检查 + 生产构建
```

## 验收流程

```
离线草稿 draft ──加入队列──▶ queued ──回网核对──▶ submitted ──回执一致──▶ accepted ──▶ 已验收快照
                                  │                   │
                                  │ 编号被占用        ├─ 回执拒收
                                  ▼                   ├─ 双方指纹/染色批次不符
                          待核区 in_review ◀──────────┘
                          （列出本地值 vs 中心值，中心侧修正后可「重新核对」）
```

每条记录的同步拆成两个幂等写入阶段：`claim`（玻片编号占用仲裁）、`receipt`（按编号核对回执）。

## 业务规则对照

| 需求 | 实现 |
| --- | --- |
| 镜检员离线补录 | 全部数据落 IndexedDB；观察记录先存为 `draft`，可随时加入发送队列 |
| 回网按玻片编号核对中心回执 | `processOutbox`：按编号占用仲裁后拉取回执，比对样本指纹与染色批次 |
| 回执拒收 / 编号被占用 → 停在待核区并列双方值 | `blockedReason.diffs` 逐条列出 `本地值 / 中心值`，卡片红字表格展示；队列条目标记终态不自动重试 |
| 两人同编号同时提交只放行一条 | 中心侧 `claims` 以玻片编号为唯一键，先到者占位，后到者进待核区（测试 `engine.test.ts` 用两台设备+共享中心状态覆盖） |
| 染色批次/标尺更新后测量结论失效 | 批次与标尺均带 `version`；观察记录钉住测量时版本，`recordStaleness` 实时判失效 |
| 未重算不能进入已验收快照 | `buildAcceptanceSnapshot` 跳过失效记录并在结果中给出跳过原因；快照不可变（只新增） |
| 写入中断保留已完成条目，只重试未完成部分 | 每个阶段成功即落盘 `completedStages`；网络故障（可重试）只回退队列条目状态，重放时跳过已完成阶段；其他记录不受影响 |

演示页的「演示中断：断在仲裁/断在回执」按钮可注入一次性网络故障，观察分阶段续传；
底部「中心实验室回执台」可下发/更正回执、拒收、释放编号占用。

## 目录

- `src/domain/types.ts` — 领域模型（样本、观察记录、回执、染色批次、标尺、快照、发送队列）
- `src/domain/engine.ts` — 验收流程全部规则（纯 TS，无 DOM 依赖）
- `src/domain/central.ts` — 中心客户端接口与本地模拟实现（含一次性故障注入）
- `src/domain/store.ts` / `src/data/idb.ts` — 存储接口、内存实现与 IndexedDB 实现
- `src/data/seed.ts` — 预置场景：一致验收 / 回执拒收 / 批次不符 / 等待回执 / 离线草稿
- `src/ui/*` — 看板、离线补录、版本管理、回执台、快照面板

## 对接真实中心实验室

替换 `src/domain/central.ts` 中 `CentralClient` 的两个方法为真实请求即可，行为契约：

- `claimSlide`：同编号被他人占用时返回 `{ ok:false, conflict }`；
- `fetchReceipt`：网络故障抛 `CentralError(retryable=true)`，业务应答不抛。
