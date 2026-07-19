import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../../src/modules/drive/document-search.service.ts", import.meta.url),
  "utf8"
);

const operatorUsages = source.match(
  /chunk\.embedding OPERATOR\(extensions\.<=>\) \$2::extensions\.vector/g
);

assert.equal(operatorUsages?.length, 2);

console.log("Document search pgvector tests passed.");
