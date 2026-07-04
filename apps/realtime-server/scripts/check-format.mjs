import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const skipped = new Set(["node_modules", "dist", "coverage"]);
const checkedExtensions = new Set([".js", ".mjs", ".json", ".ts"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (skipped.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
      continue;
    }

    if ([...checkedExtensions].some((extension) => entry.name.endsWith(extension))) {
      files.push(path);
    }
  }

  return files;
}

const failures = [];
for (const file of await collectFiles(root)) {
  const text = await readFile(file, "utf8");
  const displayPath = relative(root, file);

  if (!text.endsWith("\n")) {
    failures.push(`${displayPath}: missing trailing newline`);
  }

  text.split("\n").forEach((line, index) => {
    if (/[ \t]$/.test(line)) {
      failures.push(`${displayPath}:${index + 1}: trailing whitespace`);
    }
  });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
