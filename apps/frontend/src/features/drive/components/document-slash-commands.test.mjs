import assert from "node:assert/strict";
import test from "node:test";

import {
  filterSlashCommands,
  SLASH_COMMANDS
} from "./document-slash-commands.ts";

test("slash 검색은 공백을 무시하고 명령 label과 별칭을 함께 찾는다", () => {
  assert.deepEqual(
    filterSlashCommands(SLASH_COMMANDS, "제목3").map((command) => command.id),
    ["heading3"]
  );
  assert.deepEqual(
    filterSlashCommands(SLASH_COMMANDS, "h 2").map((command) => command.id),
    ["heading2"]
  );
});

test("slash 검색 결과가 없으면 빈 목록을 반환한다", () => {
  assert.deepEqual(filterSlashCommands(SLASH_COMMANDS, "없는 명령"), []);
});
