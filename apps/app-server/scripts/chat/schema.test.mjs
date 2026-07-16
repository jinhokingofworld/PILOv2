import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../../../db/migrations/074_create_workspace_chat.sql", import.meta.url),
  "utf8"
);
const contract = await readFile(
  new URL("../../../../docs/api/chat-api.md", import.meta.url),
  "utf8"
);

for (const table of [
  "workspace_chat_messages",
  "workspace_chat_reads",
  "workspace_chat_mentions"
]) {
  assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`));
  assert.match(
    migration,
    new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`)
  );
}
assert.match(migration, /UNIQUE \(workspace_id, sender_user_id, client_message_id\)/);
assert.match(migration, /request_fingerprint CHAR\(64\) NOT NULL/);
assert.match(
  migration,
  /request_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/
);
assert.match(migration, /char_length\(btrim\(content\)\) BETWEEN 1 AND 4000/);
assert.match(migration, /UNIQUE \(message_id, mentioned_user_id\)/);
assert.match(migration, /idx_workspace_chat_messages_workspace_created/);
assert.match(migration, /idx_workspace_chat_mentions_user_unread/);
assert.match(contract, /GET.*\/workspaces\/\{workspaceId\}\/chat\/summary/);
assert.match(contract, /POST.*\/workspaces\/\{workspaceId\}\/chat\/messages/);
assert.match(contract, /`clientMessageId` 길이는 `1\.\.128` characters다/);
assert.match(contract, /`content`는 trim 기준 `1\.\.4,000` characters다/);
assert.match(contract, /chat:message-created/);
assert.match(contract, /chat:mention-created/);
assert.match(contract, /IDEMPOTENCY_KEY_REUSED/);

for (const failureHandlingRow of [
  "| POST timeout/failure | pending message를 failed로 표시하고 same id 재시도 제공 |",
  "| Redis publish failure | DB message 유지, server log, focus/reconnect REST catch-up |",
  "| Socket disconnect | 연결 상태 표시, REST write 유지, reconnect 후 summary/history catch-up |",
  "| invalid mention member | draft 유지, member list refresh, safe validation message |",
  "| membership removed | composer disable, Chat rooms leave, auth Workspace session refresh |",
  "| stale read update | current server cursor 반환, cursor rollback 금지 |",
  "| duplicate Socket event | reducer가 message id와 deletion state로 idempotent 처리 |",
  "| deleted mention target | 안내 후 mention read, deleted message는 list/count 제외 |"
]) {
  assert.ok(
    contract.includes(failureHandlingRow),
    `Missing failure handling contract row: ${failureHandlingRow}`
  );
}
