import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const navigation = await readFile(new URL("./navigation.ts", import.meta.url), "utf8");

assert.match(navigation, /href:\s*"\/board",\s*\n\s*icon:\s*LayoutDashboard,/);
assert.match(navigation, /items:\s*\[\s*\]/);
