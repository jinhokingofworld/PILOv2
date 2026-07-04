import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

assert.match(page, /GitHub sync/);
assert.match(page, /PR review/);
assert.match(page, /Voice meeting/);
