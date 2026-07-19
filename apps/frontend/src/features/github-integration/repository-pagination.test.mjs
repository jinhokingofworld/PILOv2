import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadModule(relativePath) {
  return import(new URL(relativePath, import.meta.url));
}

const pagination = await loadModule("./utils/github-page-collector.ts");
const [panel, repositories] = await Promise.all([
  readFile(new URL("./components/github-panel.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("./components/github-connect-repositories.tsx", import.meta.url),
    "utf8"
  )
]);

const pages = await pagination.collectGithubPages((page) =>
  Promise.resolve({
    data: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) =>
      `${page}-${index}`
    ),
    meta: { total: 101 }
  })
);
assert.equal(pages.length, 101);

await assert.rejects(
  () =>
    pagination.collectGithubPages((page) =>
      Promise.resolve({
        data: page === 1 ? ["first"] : [],
        meta: { total: 2 }
      })
    ),
  /ended before the reported total/
);

assert.match(panel, /const \[repositoryPage, setRepositoryPage\] = useState\(1\)/);
assert.match(
  panel,
  /listGithubRepositories\(workspaceId, \{[\s\S]{0,200}page: repositoryPage,[\s\S]{0,200}q: repositoryQuery\.trim\(\) \|\| undefined/
);
assert.doesNotMatch(panel, /snapshot\.repositories\.filter\(/);
assert.match(
  panel,
  /function handleRepositoryQueryChange\(value: string\) \{[\s\S]{0,240}setRepositoryPage\(1\)/
);
assert.match(
  panel,
  /function handleRepositoryPageChange\(page: number\) \{[\s\S]{0,240}clearRepositorySelection\(\)/
);
assert.match(panel, /function clearRepositorySelection\(\) \{[\s\S]{0,240}setSelectedRepositoryId\(""\)/);
assert.match(repositories, /<span>보관 상태<\/span>/);
assert.match(repositories, /<span>마지막 동기화<\/span>/);
assert.match(repositories, /<span>선택<\/span>/);

console.log("GitHub repository pagination feature tests passed");
