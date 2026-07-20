import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readHomeSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("HomePage는 Pretendard Variable을 HomeDashboard 범위에만 적용한다", async () => {
  const source = await readHomeSource("./page.tsx");

  assert.match(source, /next\/font\/local/);
  assert.match(source, /PretendardVariable\.woff2/);
  assert.match(source, /pretendard\.className/);
});

test("HomeDashboard는 시안형 섹션과 기존 바로가기를 조합한다", async () => {
  const source = await readHomeSource("./components/home-dashboard.tsx");

  assert.match(source, /워크스페이스 현황/);
  assert.match(source, /GithubWorkspaceCards/);
  assert.match(
    source,
    /grid-cols-\[minmax\(260px,0\.66fr\)_minmax\(0,1\.34fr\)\]/
  );
});
