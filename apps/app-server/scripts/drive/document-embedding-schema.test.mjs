import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../../../../db/migrations/087_create_document_embedding_indexing.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(migration, /CREATE TABLE public\.document_embedding_jobs/);
assert.match(migration, /UNIQUE \(document_id, snapshot_id\)/);
assert.match(migration, /available_at TIMESTAMPTZ NOT NULL/);
assert.match(migration, /'queued', 'processing', 'completed', 'failed', 'superseded'/);
assert.match(migration, /CREATE TABLE public\.document_embedding_outbox/);
assert.match(migration, /UNIQUE \(job_id\)/);
assert.match(migration, /CREATE TABLE public\.document_embedding_chunks/);
assert.match(migration, /embedding extensions\.vector\(1536\) NOT NULL/);
assert.match(migration, /USING hnsw \(embedding vector_cosine_ops\)/);
assert.match(migration, /to_tsvector\('simple', chunk_text\)/);
assert.match(migration, /ALTER TABLE public\.document_embedding_jobs ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /ALTER TABLE public\.document_embedding_outbox ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /ALTER TABLE public\.document_embedding_chunks ENABLE ROW LEVEL SECURITY/);

console.log("Document embedding schema tests passed.");
