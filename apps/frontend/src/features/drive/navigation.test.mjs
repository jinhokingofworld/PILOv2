import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const navigation = await readFile(new URL("./navigation.ts", import.meta.url), "utf8");

assert.match(navigation, /href:\s*"\/files",\s*\n\s*icon:\s*Folder,/);
assert.match(navigation, /items:\s*\[\s*\]/);
