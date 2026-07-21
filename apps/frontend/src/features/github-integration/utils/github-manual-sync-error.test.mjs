import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const errorPolicy = await importTypeScript("./github-manual-sync-error.ts");

assert.equal(
  errorPolicy.getGithubManualSyncCompletion({ status: 429 }),
  "rate_limited"
);
assert.equal(
  errorPolicy.getGithubManualSyncCompletion({ status: 503 }), "definitive_failure");
assert.equal(errorPolicy.getGithubManualSyncCompletion({ status: 400 }), "definitive_failure");
assert.equal(errorPolicy.getGithubManualSyncCompletion(new Error("offline")), "transport_failure");
assert.equal(
  errorPolicy.getGithubManualSyncErrorMessage({ status: 429, retryAfterSeconds: 17 }),
  "동기화 요청이 일시적으로 제한되었습니다. 17초 후 다시 시도할 수 있습니다."
);
assert.equal(
  errorPolicy.getGithubManualSyncErrorMessage({ status: 503, retryAfterSeconds: 9 }),
  "동기화 대기열이 포화 상태입니다. 9초 후 다시 시도해 주세요."
);

console.log("github manual-sync error policy tests passed");
