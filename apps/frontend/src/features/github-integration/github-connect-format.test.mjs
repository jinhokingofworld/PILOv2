import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("./utils/github-connect-format.ts", import.meta.url),
  "utf8"
);
const compiled = ts.transpileModule(
  source.replace(
    'import { isGithubSyncActiveStatus } from "@/features/github-integration/utils/github-sync-progress";\n',
    'const isGithubSyncActiveStatus = (status) => status === "queued" || status === "running";\n'
  ),
  {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
  }
).outputText;
const formatModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

assert.equal(formatModule.getGithubConnectSyncStatusLabel("queued"), "진행 중");
