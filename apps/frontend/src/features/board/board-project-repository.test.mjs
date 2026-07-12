import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("./utils/board-project-repository.ts", import.meta.url),
  "utf8"
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const { selectBoardProjectRepositoryId } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const repositories = [{ id: "repository-a" }, { id: "repository-b" }];

assert.equal(
  selectBoardProjectRepositoryId(repositories, "repository-b"),
  "repository-b",
  "A persisted Board selection should take precedence over the first repository"
);
assert.equal(
  selectBoardProjectRepositoryId(repositories, "missing-repository"),
  "repository-a",
  "A missing persisted Board selection should fall back to the first repository"
);
assert.equal(
  selectBoardProjectRepositoryId([], "repository-b"),
  undefined,
  "No selectable repository should not produce a ProjectV2 request id"
);
