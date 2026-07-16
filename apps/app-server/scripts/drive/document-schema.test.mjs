import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../../../../db/migrations/073_create_workspace_documents.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(migration, /item_type IN \('folder', 'file', 'document'\)/);
assert.match(migration, /item_type = 'document'[\s\S]*object_key IS NULL/);
assert.match(migration, /CREATE TABLE public\.documents/);
assert.match(migration, /UNIQUE \(drive_item_id\)/);
assert.match(migration, /CREATE TABLE public\.document_yjs_updates/);
assert.doesNotMatch(
  migration,
  /document_yjs_updates_session_same_document_fk[\s\S]*ON DELETE SET NULL/
);
assert.match(migration, /UNIQUE \(document_id, update_sequence\)/);
assert.match(migration, /UNIQUE \(document_id, client_update_id\)/);
assert.match(migration, /CREATE TABLE public\.document_snapshots/);
assert.match(migration, /UNIQUE \(document_id, version\)/);
assert.match(migration, /CREATE TABLE public\.document_edit_sessions/);
assert.match(migration, /ALTER TABLE public\.documents ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /ALTER TABLE public\.document_yjs_updates ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /ALTER TABLE public\.document_snapshots ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /ALTER TABLE public\.document_edit_sessions ENABLE ROW LEVEL SECURITY/);

console.log("Document schema tests passed.");
