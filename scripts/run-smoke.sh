#!/usr/bin/env bash
# 真实 React 渲染冒烟（jsdom + fake-indexeddb）：离线补录→回网核对→失效重算→快照→持久化
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild tests/dom.smoke.ts --bundle --platform=node --format=esm \
  --outfile=node_modules/.tmp-smoke.mjs --log-level=warning \
  --external:jsdom --external:fake-indexeddb --external:react --external:react-dom --external:scheduler
node node_modules/.tmp-smoke.mjs
