import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
require("reflect-metadata");

const { ACTIVITY_LOG_ACTIONS } = require(
  "../../dist/common/activity-log.service.js"
);
const {
  buildSqlErdNoteActivities,
  buildSqlErdSessionChangedActivities,
  buildSqlErdSessionCreatedActivity,
  buildSqlErdSessionCreatedActivities,
  buildSqlErdSessionDeletedActivity
} = require("../../dist/modules/sql-erd/sql-erd-activity-log.js");
const { SqlErdService } = require(
  "../../dist/modules/sql-erd/sql-erd.service.js"
);

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";

const SQL_ERD_ACTIONS = [
  "sql_erd_session_created",
  "sql_erd_schema_updated",
  "sql_erd_session_renamed",
  "sql_erd_session_deleted",
  "sql_erd_note_created",
  "sql_erd_note_updated",
  "sql_erd_note_deleted"
];

for (const action of SQL_ERD_ACTIONS) {
  assert.ok(ACTIVITY_LOG_ACTIONS.includes(action), `${action} must be registered`);
}

const migration = await readFile(
  new URL("../../../../db/migrations/085_add_sql_erd_activity_log_actions.sql", import.meta.url),
  "utf8"
);
const registry = await readFile(
  new URL("../../../../docs/ActivityLogRegistry.md", import.meta.url),
  "utf8"
);
for (const action of SQL_ERD_ACTIONS) {
  assert.match(migration, new RegExp(`'${action}'`));
  assert.ok(registry.includes(`\`${action}\``));
}

function sessionRow(overrides = {}) {
  return {
    id: sessionId,
    workspace_id: workspaceId,
    title: "주문 ERD",
    source_format: "sql",
    dialect: "postgresql",
    source_text: "CREATE TABLE orders (id BIGINT);",
    model_json: { version: 1, schema: { tables: [], relations: [] } },
    layout_json: {
      version: 1,
      annotations: { version: 1, links: [], notes: [] },
      tableLayouts: []
    },
    settings_json: {},
    table_count: 1,
    relation_count: 0,
    revision: 1,
    write_protocol: "operations_v1",
    latest_op_seq: 0,
    created_by: userId,
    updated_by: userId,
    created_at: new Date("2026-07-17T00:00:00.000Z"),
    updated_at: new Date("2026-07-17T00:00:00.000Z"),
    deleted_at: null,
    ...overrides
  };
}

const userActor = { type: "user", userId };
const agentActor = { type: "agent", userId };
const createdActivity = buildSqlErdSessionCreatedActivity({
  workspaceId,
  actor: agentActor,
  session: sessionRow()
});
assert.equal(createdActivity.action, "sql_erd_session_created");
assert.deepEqual(createdActivity.actor, agentActor);
assert.equal(createdActivity.target.type, "sql_erd_session");
assert.equal(
  createdActivity.dedupeKey,
  `sqltoerd:sql_erd_session_created:${sessionId}:1`
);
assert.deepEqual(createdActivity.metadata.data, {
  title: "주문 ERD",
  dialect: "postgresql",
  tableCount: 1,
  relationCount: 0
});

const createdWithInitialNote = buildSqlErdSessionCreatedActivities({
  workspaceId,
  actor: userActor,
  session: sessionRow({
    layout_json: {
      version: 1,
      annotations: {
        version: 1,
        notes: [{ id: "initial-note", text: "초기 설계 메모" }]
      },
      tableLayouts: []
    }
  })
});
assert.deepEqual(
  createdWithInitialNote.map(({ action }) => action),
  ["sql_erd_session_created", "sql_erd_note_created"]
);
assert.equal(
  createdWithInitialNote[1].target.id,
  `${sessionId}:initial-note`
);

const changedActivities = buildSqlErdSessionChangedActivities({
  workspaceId,
  actor: userActor,
  before: sessionRow(),
  after: sessionRow({
    title: "결제 ERD",
    dialect: "mysql",
    source_text: "CREATE TABLE payments (id BIGINT);",
    model_json: {
      schema: { relations: [], tables: [{ id: "payments" }] },
      version: 1
    },
    table_count: 2,
    relation_count: 1,
    revision: 2
  })
});
assert.deepEqual(
  changedActivities.map(({ action }) => action),
  ["sql_erd_schema_updated", "sql_erd_session_renamed"]
);
assert.deepEqual(changedActivities[0].metadata.data, {
  title: "결제 ERD",
  changedFields: ["sourceText", "modelJson", "dialect"],
  dialect: "mysql",
  beforeCounts: { tableCount: 1, relationCount: 0 },
  afterCounts: { tableCount: 2, relationCount: 1 }
});
assert.deepEqual(changedActivities[1].metadata.data, {
  title: "결제 ERD",
  previousTitle: "주문 ERD"
});
assert.doesNotMatch(JSON.stringify(changedActivities), /CREATE TABLE/);

const reorderedModelActivities = buildSqlErdSessionChangedActivities({
  workspaceId,
  actor: userActor,
  before: sessionRow({
    model_json: { version: 1, schema: { tables: [], relations: [] } }
  }),
  after: sessionRow({
    model_json: { schema: { relations: [], tables: [] }, version: 1 },
    revision: 2
  })
});
assert.deepEqual(reorderedModelActivities, []);

const longNoteText = `  ${"가".repeat(501)}  다음 줄  `;
const noteCreate = buildSqlErdNoteActivities({
  workspaceId,
  sessionId,
  actor: userActor,
  beforeLayout: sessionRow().layout_json,
  afterLayout: {
    version: 1,
    annotations: {
      version: 1,
      notes: [{ id: "note-long", text: longNoteText, x: 10, y: 20 }]
    }
  },
  resultRevision: 2
});
assert.equal(noteCreate.length, 1);
assert.equal(noteCreate[0].action, "sql_erd_note_created");
assert.equal(noteCreate[0].target.type, "sql_erd_note");
assert.equal(noteCreate[0].target.id, `${sessionId}:note-long`);
assert.equal(
  noteCreate[0].dedupeKey,
  `sqltoerd:sql_erd_note_created:${sessionId}:note-long:2`
);
assert.equal(noteCreate[0].metadata.data.contentSummary.length, 500);
assert.equal(noteCreate[0].metadata.data.truncated, true);
assert.equal(noteCreate[0].metadata.data.contentOmitted, false);

const unicodeBoundaryNote = buildSqlErdNoteActivities({
  workspaceId,
  sessionId,
  actor: userActor,
  beforeLayout: sessionRow().layout_json,
  afterLayout: {
    version: 1,
    annotations: {
      version: 1,
      notes: [
        { id: "note-unicode-boundary", text: `${"a".repeat(499)}😀tail` }
      ]
    }
  },
  resultRevision: 2
});
assert.equal(
  Array.from(unicodeBoundaryNote[0].metadata.data.contentSummary).length,
  500
);
assert.match(unicodeBoundaryNote[0].metadata.data.contentSummary, /😀$/u);
assert.doesNotThrow(() => JSON.parse(JSON.stringify(unicodeBoundaryNote)));

const otherSessionNote = buildSqlErdNoteActivities({
  workspaceId,
  sessionId: "77777777-7777-4777-8777-777777777777",
  actor: userActor,
  beforeLayout: sessionRow().layout_json,
  afterLayout: {
    version: 1,
    annotations: {
      version: 1,
      notes: [{ id: "note-long", text: "다른 세션의 같은 메모 ID" }]
    }
  },
  resultRevision: 2
});
assert.notEqual(otherSessionNote[0].target.id, noteCreate[0].target.id);
assert.notEqual(otherSessionNote[0].dedupeKey, noteCreate[0].dedupeKey);

const secretNote = buildSqlErdNoteActivities({
  workspaceId,
  sessionId,
  actor: userActor,
  beforeLayout: sessionRow().layout_json,
  afterLayout: {
    version: 1,
    annotations: {
      version: 1,
      notes: [{ id: "note-secret", text: "API_KEY=sk-super-secret-value" }]
    }
  },
  resultRevision: 2
});
assert.equal(secretNote[0].metadata.data.contentSummary, "");
assert.equal(secretNote[0].metadata.data.contentOmitted, true);
assert.doesNotMatch(JSON.stringify(secretNote), /super-secret-value/);

for (const [index, sensitiveText] of [
  "postgresql://demo:fake-password@example.invalid/pilo",
  "AKIA0000000000000000",
  "xoxb-example-placeholder-token",
  ["gl", "pat-", "example_placeholder_token"].join(""),
  "password is fake-placeholder-value",
  "github_pat_00000000000000000000",
  "sk_live_00000000000000000000",
  "비밀번호는 테스트-비밀값"
].entries()) {
  const sensitiveNote = buildSqlErdNoteActivities({
    workspaceId,
    sessionId,
    actor: userActor,
    beforeLayout: sessionRow().layout_json,
    afterLayout: {
      version: 1,
      annotations: {
        version: 1,
        notes: [{ id: `note-sensitive-${index}`, text: sensitiveText }]
      }
    },
    resultRevision: 2
  });
  assert.equal(sensitiveNote[0].metadata.data.contentSummary, "");
  assert.equal(sensitiveNote[0].metadata.data.contentOmitted, true);
  assert.doesNotMatch(JSON.stringify(sensitiveNote), new RegExp(sensitiveText));
}

const sensitiveTitleActivity = buildSqlErdSessionCreatedActivity({
  workspaceId,
  actor: userActor,
  session: sessionRow({ title: "비밀번호는 테스트-비밀값" })
});
assert.equal(sensitiveTitleActivity.metadata.data.title, "제목 비공개");
assert.doesNotMatch(JSON.stringify(sensitiveTitleActivity), /테스트-비밀값/u);

const geometryOnly = buildSqlErdNoteActivities({
  workspaceId,
  sessionId,
  actor: userActor,
  beforeLayout: {
    version: 1,
    annotations: { version: 1, notes: [{ id: "note-1", text: "검토 필요", x: 0 }] }
  },
  afterLayout: {
    version: 1,
    annotations: { version: 1, notes: [{ id: "note-1", text: "검토 필요", x: 100 }] }
  },
  resultRevision: 2
});
assert.deepEqual(geometryOnly, []);

const whitespaceOnly = buildSqlErdNoteActivities({
  workspaceId,
  sessionId,
  actor: userActor,
  beforeLayout: {
    version: 1,
    annotations: {
      version: 1,
      notes: [{ id: "note-whitespace", text: "검토   필요" }]
    }
  },
  afterLayout: {
    version: 1,
    annotations: {
      version: 1,
      notes: [{ id: "note-whitespace", text: "  검토 필요\n" }]
    }
  },
  resultRevision: 2
});
assert.deepEqual(whitespaceOnly, []);

const blankCreate = buildSqlErdNoteActivities({
  workspaceId,
  sessionId,
  actor: userActor,
  beforeLayout: sessionRow().layout_json,
  afterLayout: {
    version: 1,
    annotations: { version: 1, notes: [{ id: "note-blank", text: "  \n " }] }
  },
  resultRevision: 2
});
assert.deepEqual(blankCreate, []);

const noteUpdateAndDelete = buildSqlErdNoteActivities({
  workspaceId,
  sessionId,
  actor: userActor,
  beforeLayout: {
    version: 1,
    annotations: {
      version: 1,
      notes: [
        { id: "note-update", text: "기존 내용" },
        { id: "note-delete", text: "삭제될 내용" }
      ]
    }
  },
  afterLayout: {
    version: 1,
    annotations: {
      version: 1,
      notes: [{ id: "note-update", text: "변경된   내용" }]
    }
  },
  resultRevision: 3
});
assert.deepEqual(
  noteUpdateAndDelete.map(({ action }) => action),
  ["sql_erd_note_updated", "sql_erd_note_deleted"]
);
assert.equal(
  noteUpdateAndDelete[0].metadata.data.contentSummary,
  "변경된 내용"
);
assert.deepEqual(noteUpdateAndDelete[1].metadata.data, { sessionId });
assert.doesNotMatch(JSON.stringify(noteUpdateAndDelete[1]), /삭제될 내용/);

const deletedActivity = buildSqlErdSessionDeletedActivity({
  workspaceId,
  actor: userActor,
  session: sessionRow({ revision: 2, deleted_at: new Date() })
});
assert.equal(deletedActivity.action, "sql_erd_session_deleted");
assert.deepEqual(deletedActivity.metadata.data, {
  title: "주문 ERD",
  tableCount: 1,
  relationCount: 0
});

class OperationDatabase {
  constructor() {
    this.session = sessionRow();
    this.transactionObject = null;
  }

  async transaction(callback) {
    this.transactionObject = {
      query: this.query.bind(this),
      queryOne: this.queryOne.bind(this),
      execute: this.execute.bind(this)
    };
    return callback(this.transactionObject);
  }

  async query() {
    return [];
  }

  async queryOne(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("FROM sql_erd_sessions")) return this.session;
    if (normalized.includes("FROM sql_erd_session_operations")) return null;
    if (normalized.startsWith("UPDATE sql_erd_sessions")) {
      this.session = sessionRow({
        layout_json: JSON.parse(params[2]),
        revision: 2,
        latest_op_seq: 1
      });
      return this.session;
    }
    if (normalized.startsWith("INSERT INTO sql_erd_session_operations")) {
      return {
        id: operationId,
        workspace_id: workspaceId,
        session_id: sessionId,
        actor_user_id: userId,
        operation_type: "layout_patch",
        op_seq: 1,
        client_operation_id: params[5],
        base_revision: params[6],
        applied_on_revision: params[7],
        result_revision: params[8],
        payload: JSON.parse(params[9]),
        request_fingerprint: null,
        source_snapshot_id: null,
        created_at: new Date("2026-07-17T00:00:00.000Z")
      };
    }
    throw new Error(`Unexpected queryOne: ${normalized}`);
  }

  async execute(sql) {
    assert.match(sql, /sql_erd_session_operation_outbox/);
  }
}

class FakeActivityLogService {
  constructor(error = null) {
    this.error = error;
    this.calls = [];
  }

  async append(transaction, input) {
    this.calls.push({ transaction, input });
    if (this.error) throw this.error;
  }
}

const workspaceService = {
  async assertWorkspaceAccess() {
    return { id: workspaceId };
  }
};

const operationDatabase = new OperationDatabase();
const activityLogService = new FakeActivityLogService();
const operationService = new SqlErdService(
  operationDatabase,
  workspaceService,
  activityLogService
);
await operationService.createOperation(userId, workspaceId, sessionId, {
  baseRevision: 1,
  clientOperationId: "55555555-5555-4555-8555-555555555555",
  type: "layout_patch",
  patch: {
    annotations: {
      notes: {
        upsert: [
          {
            id: "note-activity",
            x: 10,
            y: 20,
            width: 240,
            height: 160,
            text: "결제 FK를 검토했습니다."
          }
        ]
      }
    }
  }
});
assert.equal(activityLogService.calls.length, 1);
assert.equal(activityLogService.calls[0].transaction, operationDatabase.transactionObject);
assert.equal(activityLogService.calls[0].input.action, "sql_erd_note_created");

const appendError = new Error("activity append failed");
const failingDatabase = new OperationDatabase();
const failingActivityLogService = new FakeActivityLogService(appendError);
const failingService = new SqlErdService(
  failingDatabase,
  workspaceService,
  failingActivityLogService
);
await assert.rejects(
  () =>
    failingService.createOperation(userId, workspaceId, sessionId, {
      baseRevision: 1,
      clientOperationId: "66666666-6666-4666-8666-666666666666",
      type: "layout_patch",
      patch: {
        annotations: {
          notes: {
            upsert: [
              {
                id: "note-failure",
                x: 10,
                y: 20,
                width: 240,
                height: 160,
                text: "rollback 검증"
              }
            ]
          }
        }
      }
    }),
  appendError
);
assert.equal(
  failingActivityLogService.calls[0].transaction,
  failingDatabase.transactionObject
);

console.log("SQLtoERD Activity Log tests passed.");
