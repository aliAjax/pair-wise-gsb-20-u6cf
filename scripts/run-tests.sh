#!/usr/bin/env bash
# 纯逻辑测试（engine + centralLab + 端到端工作流），用 esbuild 打包到 node 运行
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild tests/run.ts --bundle --platform=node --format=cjs --outfile=node_modules/.tmp-tests.cjs --log-level=warning
node node_modules/.tmp-tests.cjs
