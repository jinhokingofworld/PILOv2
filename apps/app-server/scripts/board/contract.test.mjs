import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function section(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `${heading} section should exist`);

  const nextHeading = source.indexOf("\n## ", start + heading.length);
  return nextHeading === -1 ? source.slice(start) : source.slice(start, nextHeading);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const boardApi = await readSource("../../../../docs/api/board-api.md");
const apiReadme = await readSource("../../../../docs/api/README.md");
const mvpExcluded = section(boardApi, "## MVP 제외");
const issueStatus = section(boardApi, "## Issue Status 변경");
const issueUpdate = section(boardApi, "## Issue 수정");
const assigneeOptions = section(boardApi, "## Issue 담당자 후보 조회");

const writeEndpoints = [
  "PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status",
  "PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}",
  "POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues"
];

for (const endpoint of writeEndpoints) {
  assert.match(boardApi, new RegExp(escapeRegExp(endpoint)));
  assert.doesNotMatch(mvpExcluded, new RegExp(`^${escapeRegExp(endpoint)}$`, "m"));
}

assert.match(boardApi, /Board API는 GitHub를 source of truth로 사용한다/);
assert.match(boardApi, /GitHub write 성공 후 로컬 `pilo_issues` cache를 갱신한다/);
assert.match(boardApi, /실패 시 클라이언트는 GitHub 기준으로 rollback 또는 refresh한다/);

assert.match(issueStatus, /"columnId": "column_uuid"/);
assert.doesNotMatch(issueStatus, /previous_column_uuid/);
assert.match(issueStatus, /성공 응답:[\s\S]*"previousColumnId": "6"/);
assert.match(issueStatus, /ProjectV2 `Status` field value를 변경한다/);

assert.match(boardApi, /## Issue 수정/);
assert.match(boardApi, /"title": "OAuth callback state 바인딩 보강"/);
assert.match(boardApi, /"body": "본문 markdown"/);
assert.match(boardApi, /"state": "open"/);
assert.match(issueUpdate, /"assignees": \["Developer-EJ"\]/);
assert.match(issueUpdate, /빈 배열.*모든 담당자/);
assert.match(
  issueUpdate,
  /성공 응답:[\s\S]*"assignees": \[[\s\S]*"login": "Developer-EJ"[\s\S]*"avatar_url": "https:\/\/avatars\.githubusercontent\.com\/u\/1\?v=4"/
);
assert.doesNotMatch(issueUpdate, /labels, assignees, milestone/);
assert.match(issueUpdate, /title\/body\/state\/assignees 외 labels, milestone/);

assert.match(
  assigneeOptions,
  /GET \/api\/v1\/workspaces\/\{workspaceId\}\/boards\/\{boardId\}\/issues\/\{issueId\}\/assignee-options/
);
assert.match(assigneeOptions, /저장소에 지정 가능한 GitHub 사용자/);
assert.match(assigneeOptions, /"avatarUrl"/);

assert.match(boardApi, /## Issue 생성/);
assert.match(boardApi, /"columnId": "column_uuid"/);
assert.match(boardApi, /서버는 Board가 참조하는 repository와 ProjectV2를 사용한다/);
assert.match(boardApi, /Idempotency-Key/);
assert.match(boardApi, /`Idempotency-Key`는 필수/);
assert.match(boardApi, /같은 key와 같은 요청/);
assert.match(boardApi, /기존 성공 응답과 `201 Created`/);
assert.match(boardApi, /같은 key와 다른 요청/);
assert.match(boardApi, /`409 CONFLICT`/);
assert.match(boardApi, /`processing`/);
assert.match(boardApi, /`retryable`/);
assert.match(boardApi, /GitHub Issue 생성 응답을 받지 못한 경우/);

assert.match(boardApi, /권한 규칙/);
assert.match(boardApi, /현재 사용자는 해당 Workspace에 접근할 수 있어야 한다/);
assert.match(boardApi, /현재 사용자의 GitHub App user OAuth token/);
assert.match(boardApi, /API 응답이나 로그에 GitHub token/);

assert.match(boardApi, /400 BAD_REQUEST/);
assert.match(boardApi, /403 FORBIDDEN/);
assert.match(boardApi, /404 NOT_FOUND/);
assert.match(boardApi, /409 CONFLICT/);
assert.match(boardApi, /502 BAD_GATEWAY/);
assert.doesNotMatch(mvpExcluded, /issue label, assignee, milestone 직접 변경/);

assert.match(
  apiReadme,
  /\[board-api\.md\]\(board-api\.md\).*issue 생성\/수정과 Status 변경/
);
assert.doesNotMatch(apiReadme, /MVP 제외:[^\n]*GitHub issue write API/);
