import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const {
  upsertChatReadState
} = require("../../dist/modules/chat/chat-queries.js");

const connectionString = process.env.CHAT_POSTGRES_TEST_URL;
assert.ok(connectionString, "CHAT_POSTGRES_TEST_URL is required");
const databaseUrl = new URL(connectionString);
assert.ok(
  databaseUrl.hostname === "127.0.0.1" || databaseUrl.hostname === "localhost",
  "Chat PostgreSQL test must use a loopback host"
);
assert.equal(
  databaseUrl.pathname,
  "/pilo_chat_1186",
  "Chat PostgreSQL test must use its disposable database"
);

const migration = await readFile(
  new URL("../../../../db/migrations/074_create_workspace_chat.sql", import.meta.url),
  "utf8"
);
const pool = new Pool({ connectionString, max: 4 });

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const oldestMessageId = "10000000-0000-4000-8000-000000000001";
const middleMessageId = "10000000-0000-4000-8000-000000000002";
const newestMessageId = "10000000-0000-4000-8000-000000000003";
const validFingerprint = "a".repeat(64);

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function transactionFor(client, hooks = {}) {
  return {
    async query(text, values = []) {
      return (await client.query(text, values)).rows;
    },
    async queryOne(text, values = []) {
      await hooks.beforeQueryOne?.(text);
      const row = (await client.query(text, values)).rows[0] ?? null;
      await hooks.afterQueryOne?.(text);
      return row;
    },
    async execute(text, values = []) {
      await hooks.beforeExecute?.(text);
      const result = await client.query(text, values);
      await hooks.afterExecute?.(text);
      return result;
    }
  };
}

async function runReadUpdate(messageId, hooks = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await upsertChatReadState(transactionFor(client, hooks), {
      workspaceId,
      userId,
      messageId
    });
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function waitForBlockedBackend(pid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_locks
          WHERE pid = $1
            AND NOT granted
        ) AS blocked
      `,
      [pid]
    );
    if (result.rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("membership DELETE backend did not wait for a database lock");
}

try {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(`
    CREATE TABLE public.users (id UUID PRIMARY KEY);
    CREATE TABLE public.workspaces (id UUID PRIMARY KEY);
    CREATE TABLE public.workspace_members (
      workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE FUNCTION public.update_updated_at_column()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
  `);
  await pool.query(migration);
  await pool.query("INSERT INTO public.users (id) VALUES ($1), ($2)", [
    userId,
    otherUserId
  ]);
  await pool.query("INSERT INTO public.workspaces (id) VALUES ($1)", [
    workspaceId
  ]);
  await pool.query(
    `
      INSERT INTO public.workspace_members (workspace_id, user_id)
      VALUES ($1, $2), ($1, $3)
    `,
    [workspaceId, userId, otherUserId]
  );

  await pool.query(
    `
      INSERT INTO workspace_chat_messages (
        id,
        workspace_id,
        sender_user_id,
        client_message_id,
        content,
        request_fingerprint,
        created_at
      )
      VALUES
        ($1, $4, $5, 'oldest', 'oldest', $6, '2026-07-16T00:01:00.000Z'),
        ($2, $4, $5, 'middle', 'middle', $6, '2026-07-16T00:02:00.000Z'),
        ($3, $4, $5, 'newest', 'newest', $6, '2026-07-16T00:03:00.000Z')
    `,
    [
      oldestMessageId,
      middleMessageId,
      newestMessageId,
      workspaceId,
      otherUserId,
      validFingerprint
    ]
  );

  for (const [clientMessageId, fingerprint] of [
    ["short-fingerprint", "a".repeat(63)],
    ["uppercase-fingerprint", "A".repeat(64)],
    ["non-hex-fingerprint", "g".repeat(64)]
  ]) {
    await assert.rejects(
      pool.query(
        `
          INSERT INTO workspace_chat_messages (
            workspace_id,
            sender_user_id,
            client_message_id,
            content,
            request_fingerprint
          )
          VALUES ($1, $2, $3, 'invalid', $4)
        `,
        [workspaceId, otherUserId, clientMessageId, fingerprint]
      ),
      error => error.code === "23514"
    );
  }
  await assert.rejects(
    pool.query(
      `
        INSERT INTO workspace_chat_messages (
          workspace_id,
          sender_user_id,
          client_message_id,
          content,
          request_fingerprint
        )
        VALUES ($1, $2, 'null-fingerprint', 'invalid', NULL)
      `,
      [workspaceId, otherUserId]
    ),
    error => error.code === "23502"
  );

  await pool.query(
    `
      UPDATE workspace_chat_messages
      SET content = NULL, deleted_at = now(), deleted_by_user_id = $2
      WHERE workspace_id = $1 AND id = $3
    `,
    [workspaceId, otherUserId, oldestMessageId]
  );
  const retainedFingerprint = await pool.query(
    `
      SELECT request_fingerprint
      FROM workspace_chat_messages
      WHERE workspace_id = $1 AND id = $2
    `,
    [workspaceId, oldestMessageId]
  );
  assert.equal(retainedFingerprint.rows[0].request_fingerprint, validFingerprint);

  const firstInsertFinished = deferred();
  const releaseFirstInsert = deferred();
  const secondInsertStarted = deferred();
  const newestInsert = runReadUpdate(newestMessageId, {
    async afterExecute(text) {
      if (!text.includes("INSERT INTO workspace_chat_reads")) return;
      firstInsertFinished.resolve();
      await releaseFirstInsert.promise;
    }
  });
  await firstInsertFinished.promise;
  const staleConcurrentInsert = runReadUpdate(middleMessageId, {
    async beforeExecute(text) {
      if (text.includes("INSERT INTO workspace_chat_reads")) {
        secondInsertStarted.resolve();
      }
    }
  });
  await secondInsertStarted.promise;
  releaseFirstInsert.resolve();
  const [newestInsertRow, staleInsertRow] = await Promise.all([
    newestInsert,
    staleConcurrentInsert
  ]);
  assert.equal(newestInsertRow.last_read_message_id, newestMessageId);
  assert.equal(staleInsertRow.last_read_message_id, newestMessageId);

  await pool.query("DELETE FROM workspace_chat_reads");
  await runReadUpdate(oldestMessageId);
  const firstLockFinished = deferred();
  const releaseFirstLock = deferred();
  const secondLockStarted = deferred();
  const newestUpdate = runReadUpdate(newestMessageId, {
    async afterQueryOne(text) {
      if (!text.includes("FOR UPDATE OF read_state")) return;
      firstLockFinished.resolve();
      await releaseFirstLock.promise;
    }
  });
  await firstLockFinished.promise;
  const staleConcurrentUpdate = runReadUpdate(middleMessageId, {
    async beforeQueryOne(text) {
      if (text.includes("FOR UPDATE OF read_state")) {
        secondLockStarted.resolve();
      }
    }
  });
  await secondLockStarted.promise;
  releaseFirstLock.resolve();
  const [newestUpdateRow, staleUpdateRow] = await Promise.all([
    newestUpdate,
    staleConcurrentUpdate
  ]);
  assert.equal(newestUpdateRow.last_read_message_id, newestMessageId);
  assert.equal(staleUpdateRow.last_read_message_id, newestMessageId);

  const finalRead = await pool.query(
    `
      SELECT last_read_message_id
      FROM workspace_chat_reads
      WHERE workspace_id = $1 AND user_id = $2
    `,
    [workspaceId, userId]
  );
  assert.equal(finalRead.rows[0].last_read_message_id, newestMessageId);

  const accessCheck = await pool.query(
    `
      SELECT user_id
      FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `,
    [workspaceId, userId]
  );
  assert.equal(accessCheck.rowCount, 1);
  await pool.query(
    `
      DELETE FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `,
    [workspaceId, userId]
  );
  await assert.rejects(
    runReadUpdate(newestMessageId),
    error =>
      error.getStatus?.() === 403 &&
      error.getResponse?.().error.code === "FORBIDDEN"
  );

  await pool.query(
    `
      INSERT INTO workspace_members (workspace_id, user_id)
      VALUES ($1, $2)
    `,
    [workspaceId, userId]
  );
  await runReadUpdate(newestMessageId);
  const membershipLockAcquired = deferred();
  const releaseMembershipLock = deferred();
  const lockedRead = runReadUpdate(middleMessageId, {
    async afterQueryOne(text) {
      if (!text.includes("FROM workspace_members AS membership")) return;
      membershipLockAcquired.resolve();
      await releaseMembershipLock.promise;
    }
  });
  await membershipLockAcquired.promise;
  const removalClient = await pool.connect();
  const removalBackend = await removalClient.query(
    "SELECT pg_backend_pid()::int AS pid"
  );
  let concurrentRemovalFinished = false;
  const concurrentRemoval = removalClient
    .query(
      `
        DELETE FROM workspace_members
        WHERE workspace_id = $1 AND user_id = $2
      `,
      [workspaceId, userId]
    )
    .then(() => {
      concurrentRemovalFinished = true;
    })
    .finally(() => {
      removalClient.release();
    });

  let lockObservationError = null;
  try {
    await waitForBlockedBackend(removalBackend.rows[0].pid);
    assert.equal(
      concurrentRemovalFinished,
      false,
      "membership removal must wait for the read-state transaction lock"
    );
  } catch (error) {
    lockObservationError = error;
  } finally {
    releaseMembershipLock.resolve();
  }
  const lockedReadRow = await lockedRead;
  await concurrentRemoval;
  if (lockObservationError) throw lockObservationError;
  assert.equal(lockedReadRow.last_read_message_id, newestMessageId);
} finally {
  await pool.end();
}
