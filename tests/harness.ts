// 极简断言工具，配合 esbuild 打包在 node 中运行
let passed = 0;
let failed = 0;
const failures: string[] = [];

export function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed += 1;
      failures.push(name);
      console.error(`  ✗ ${name}`);
      console.error(`    ${(err as Error)?.stack ?? err}`);
    });
}

export function eq<T>(actual: T, expected: T, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg ?? "相等断言失败"}\n      期望: ${e}\n      实际: ${a}`);
  }
}

export function ok(v: unknown, msg?: string) {
  if (!v) throw new Error(msg ?? "期望真值");
}

export function finish() {
  console.log(`\n${passed} 通过, ${failed} 失败`);
  if (failed > 0) {
    console.error("失败用例: " + failures.join("; "));
    process.exit(1);
  }
}
