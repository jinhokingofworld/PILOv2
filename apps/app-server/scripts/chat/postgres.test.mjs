import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const {
  ChatService
} = require("../../dist/modules/chat/chat.service.js");
const {
  lockChatMembership,
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
const deletableMessageId = "10000000-0000-4000-8000-000000000004";
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
      await hooks.beforeQuery?.(text);
      const rows = (await client.query(text, values)).rows;
      await hooks.afterQuery?.(text);
      return rows;
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

class PostgresDatabase {
  constructor(hooks = {}) {
    this.hooks = hooks;
  }

  async query(text, values = []) {
    return (await pool.query(text, values)).rows;
  }

  async queryOne(text, values = []) {
    return (await pool.query(text, values)).rows[0] ?? null;
  }

  async transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(transactionFor(client, this.hooks));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

class PostgresWorkspaceService {
  constructor(afterAccess) {
    this.afterAccess = afterAccess;
  }

  async assertWorkspaceAccess(currentUserId, targetWorkspaceId) {
    const result = await pool.query(
      `
        SELECT 1
        FROM workspace_members
        WHERE workspace_id = $1 AND user_id = $2
      `,
      [targetWorkspaceId, currentUserId]
    );
    assert.equal(result.rowCount, 1, "REST precheck requires an initial membership");
    await this.afterAccess?.();
    return { id: targetWorkspaceId };
  }
}

class RecordingPublisher {
  constructor() {
    this.events = [];
  }

  async publish(event) {
    this.events.push(event);
  }
}

function createChatService({ afterAccess, transactionHooks } = {}) {
  const publisher = new RecordingPublisher();
  const service = new ChatService(
    new PostgresDatabase(transactionHooks),
    new PostgresWorkspaceService(afterAccess),
    publisher
  );
  return { publisher, service };
}

async function runReadUpdate(messageId, hooks = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockChatMembership(transactionFor(client, hooks), workspaceId, userId);
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

async function restoreMembership(targetUserId = userId) {
  await pool.query(
    `
      INSERT INTO workspace_members (workspace_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `,
    [workspaceId, targetUserId]
  );
}

async function removeMembership(targetUserId = userId) {
  await pool.query(
    `
      DELETE FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `,
    [workspaceId, targetUserId]
  );
}

async function assertForbidden(action) {
  await assert.rejects(
    action,
    error =>
      error.getStatus?.() === 403 &&
      error.getResponse?.().error.code === "FORBIDDEN"
  );
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

async function beginMembershipRemoval(targetUserId) {
  const client = await pool.connect();
  const backend = await client.query("SELECT pg_backend_pid()::int AS pid");
  let finished = false;
  const promise = client
    .query(
      `
        DELETE FROM workspace_members
        WHERE workspace_id = $1 AND user_id = $2
      `,
      [workspaceId, targetUserId]
    )
    .then(() => {
      finished = true;
    })
    .finally(() => {
      client.release();
    });
  return {
    get finished() {
      return finished;
    },
    pid: backend.rows[0].pid,
    promise
  };
}

async function runAfterCommittedMembershipRemoval(action) {
  await restoreMembership();
  const accessChecked = deferred();
  const releaseAccess = deferred();
  const { publisher, service } = createChatService({
    async afterAccess() {
      accessChecked.resolve();
      await releaseAccess.promise;
    }
  });
  const operation = action(service);
  await accessChecked.promise;
  await removeMembership();
  releaseAccess.resolve();
  await assertForbidden(operation);
  assert.deepEqual(publisher.events, []);
}

try {
  const serverVersion = await pool.query(
    "SHOW server_version_num"
  );
  assert.match(
    serverVersion.rows[0].server_version_num,
    /^16\d{4}$/,
    "Chat PostgreSQL races must run on PostgreSQL 16"
  );
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(`
    CREATE TABLE public.users (
      id UUID PRIMARY KEY,
      name TEXT,
      email TEXT,
      avatar_url TEXT
    );
    CREATE TABLE public.user_settings (
      user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
      display_name TEXT,
      avatar_mode TEXT,
      custom_avatar_url TEXT
    );
    CREATE TABLE public.workspaces (id UUID PRIMARY KEY, name TEXT NOT NULL);
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
  await pool.query("INSERT INTO public.users (id, name) VALUES ($1, 'Sender'), ($2, 'Other')", [
    userId,
    otherUserId
  ]);
  await pool.query("INSERT INTO public.workspaces (id, name) VALUES ($1, 'PILO')", [
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
        ($3, $4, $5, 'newest', 'newest', $6, '2026-07-16T00:03:00.000Z'),
        ($7, $4, $8, 'deletable', 'delete me', $6, '2026-07-16T00:04:00.000Z')
    `,
    [
      oldestMessageId,
      middleMessageId,
      newestMessageId,
      workspaceId,
      otherUserId,
      validFingerprint,
      deletableMessageId,
      userId
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

  await runAfterCommittedMembershipRemoval(service =>
    service.createMessage(userId, workspaceId, {
      clientMessageId: "create-after-revoke",
      content: "must not be inserted",
      mentionedUserIds: []
    })
  );
  const revokedCreate = await pool.query(
    `
      SELECT 1
      FROM workspace_chat_messages
      WHERE workspace_id = $1
        AND sender_user_id = $2
        AND client_message_id = 'create-after-revoke'
    `,
    [workspaceId, userId]
  );
  assert.equal(revokedCreate.rowCount, 0);

  await runAfterCommittedMembershipRemoval(service =>
    service.listMessages(userId, workspaceId, {})
  );
  await runAfterCommittedMembershipRemoval(service =>
    service.getMessageContext(userId, workspaceId, newestMessageId)
  );

  await runAfterCommittedMembershipRemoval(service =>
    service.deleteMessage(userId, workspaceId, deletableMessageId)
  );
  const messageAfterRevokedDelete = await pool.query(
    `
      SELECT content, deleted_at
      FROM workspace_chat_messages
      WHERE workspace_id = $1 AND id = $2
    `,
    [workspaceId, deletableMessageId]
  );
  assert.equal(messageAfterRevokedDelete.rows[0].content, "delete me");
  assert.equal(messageAfterRevokedDelete.rows[0].deleted_at, null);

  await restoreMembership();
  const createMembershipLocked = deferred();
  const releaseCreateMembership = deferred();
  const createSubject = createChatService({
    transactionHooks: {
      async afterQueryOne(text) {
        if (!text.includes("FROM workspace_members AS membership")) return;
        createMembershipLocked.resolve();
        await releaseCreateMembership.promise;
      }
    }
  });
  const lockedCreate = createSubject.service.createMessage(userId, workspaceId, {
    clientMessageId: "create-before-revoke",
    content: "created before membership removal",
    mentionedUserIds: []
  });
  await createMembershipLocked.promise;
  const blockedSenderRemoval = await beginMembershipRemoval(userId);
  let createLockObservationError = null;
  try {
    await waitForBlockedBackend(blockedSenderRemoval.pid);
    assert.equal(
      blockedSenderRemoval.finished,
      false,
      "membership DELETE must wait for the create transaction membership lock"
    );
    assert.deepEqual(
      createSubject.publisher.events,
      [],
      "create event must remain post-commit while the transaction is held"
    );
  } catch (error) {
    createLockObservationError = error;
  } finally {
    releaseCreateMembership.resolve();
  }
  const createdBeforeRemoval = await lockedCreate;
  await blockedSenderRemoval.promise;
  if (createLockObservationError) throw createLockObservationError;
  assert.equal(createdBeforeRemoval.replayed, false);
  assert.equal(createSubject.publisher.events[0].type, "message.created");

  await restoreMembership();
  await restoreMembership(otherUserId);
  const mentionTargetsLocked = deferred();
  const releaseMentionTargets = deferred();
  const mentionSubject = createChatService({
    transactionHooks: {
      async afterQuery(text) {
        if (!text.includes("membership.user_id = ANY($2::uuid[])")) return;
        mentionTargetsLocked.resolve();
        assert.match(text, /FOR KEY SHARE OF membership/);
        await releaseMentionTargets.promise;
      }
    }
  });
  const mentionedCreate = mentionSubject.service.createMessage(
    userId,
    workspaceId,
    {
      clientMessageId: "recipient-before-revoke",
      content: "@Other please review",
      mentionedUserIds: [otherUserId]
    }
  );
  await mentionTargetsLocked.promise;
  const blockedRecipientRemoval = await beginMembershipRemoval(otherUserId);
  let mentionLockObservationError = null;
  try {
    await waitForBlockedBackend(blockedRecipientRemoval.pid);
    assert.equal(
      blockedRecipientRemoval.finished,
      false,
      "recipient membership DELETE must wait for mention target validation"
    );
  } catch (error) {
    mentionLockObservationError = error;
  } finally {
    releaseMentionTargets.resolve();
  }
  const createdWithMention = await mentionedCreate;
  await blockedRecipientRemoval.promise;
  if (mentionLockObservationError) throw mentionLockObservationError;
  assert.equal(createdWithMention.message.mentions[0].userId, otherUserId);
  assert.equal(mentionSubject.publisher.events[0].type, "message.created");
  const removedRecipientMentions = await pool.query(
    `
      SELECT 1
      FROM workspace_chat_mentions
      WHERE workspace_id = $1 AND mentioned_user_id = $2
    `,
    [workspaceId, otherUserId]
  );
  assert.equal(removedRecipientMentions.rowCount, 0);
} finally {
  await pool.end();
}
