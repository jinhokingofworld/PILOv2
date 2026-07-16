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
assert.match(migration, /char_length\(btrim\(content\)\) BETWEEN 1 AND 4000/);
assert.match(migration, /UNIQUE \(message_id, mentioned_user_id\)/);
assert.match(migration, /idx_workspace_chat_messages_workspace_created/);
assert.match(migration, /idx_workspace_chat_mentions_user_unread/);
assert.match(contract, /GET.*\/workspaces\/\{workspaceId\}\/chat\/summary/);
assert.match(contract, /POST.*\/workspaces\/\{workspaceId\}\/chat\/messages/);
assert.match(contract, /chat:message-created/);
assert.match(contract, /chat:mention-created/);
assert.match(contract, /IDEMPOTENCY_KEY_REUSED/);
