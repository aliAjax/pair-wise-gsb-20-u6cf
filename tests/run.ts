import { finish } from "./harness";
import { engineTests } from "./engine.test";
import { centralTests } from "./centralLab.test";
import { workflowTests } from "./workflow.test";

async function main() {
  console.log("领域规则（测量依赖 / 回执核对 / 快照门槛）");
  await engineTests();
  console.log("\n中心实验室（拒收 / 占用 / 并发 / 幂等）");
  await centralTests();
  console.log("\n端到端流程（离线补录 / 中断恢复 / 逐条落库）");
  await workflowTests();
  finish();
}

void main();
