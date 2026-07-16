# SQLtoERD Agent Tool Proposed Contract

> **Status: Proposed.** This document is not the current API contract. None of
> the request fields, execution modes, confirmation shapes or tool behaviors
> described below are active. Implementation PRs must update
> `docs/api/agent-api.md` and `docs/api/sqltoerd-api.md` before activation.

Related issue: #1162

## 1. Goal

Add one `generate_sql_erd` tool to the existing workspace-wide Agent chat. The
tool turns a natural-language database description into a validated SQLtoERD
session without executing DDL against a database.

The AI Worker produces a bounded structured schema. Deterministic App Server
code validates the schema and produces all three canonical SQLtoERD values:

- `sourceText`: dialect-specific DDL
- `modelJson`: SQLtoERD modelJson v1
- `layoutJson`: SQLtoERD layoutJson v1

The existing SQLtoERD frontend loads the saved session and renders it through
tldraw. The Agent tool does not replace the canvas renderer.

## 2. Product behavior

### 2.1 Outside a SQLtoERD session

The App Server resolves `generate_sql_erd` to automatic execution. A new
SQLtoERD session is created immediately and the Agent response includes an
`ERD 및 DDL 열기` resource link.

This is a narrow policy exception for an additive, workspace-local artifact
explicitly requested by the user. It does not execute SQL, modify an existing
resource or contact an external provider. Existing medium-risk tools keep their
current confirmation behavior.

### 2.2 Inside a SQLtoERD session

The Agent displays one server-created choice confirmation:

1. Create a new session
2. Replace the current session schema
3. Cancel

Choosing a target executes immediately without a second approval.
The target choice itself is the explicit user decision required before an
existing session can be changed.

Current-session replacement:

- is supported only for `operations_v1` sessions;
- preserves the session ID, title, settings, viewport, notes, frames, texts and
  strokes;
- preserves table positions where the generated model has the same stable
  table ID;
- replaces sourceText, tables, columns, PK, UK, FK and relations;
- removes stale table layouts and annotation links;
- appends one durable `source_snapshot` operation and broadcasts through the
  existing operation outbox.

A legacy `snapshot` session cannot be replaced by this tool. The Agent directs
the user to create a new session instead.

### 2.3 Dialect resolution

- New session with an explicit dialect: use the requested dialect.
- New session without an explicit dialect: use PostgreSQL.
- Current session with PostgreSQL, MySQL or SQLite: preserve that dialect.
- Current session with an explicit conflicting dialect request: reject replace
  and offer new-session creation.
- Current session with `dialect = auto`: preserve `auto`; render the requested
  dialect, or PostgreSQL when none was requested.

The schemaSpec title is used for a new session and ignored for current-session
replacement, where the existing title is preserved.

## 3. Out of scope

- Executing DDL against a database
- A separate `generate_sql_ddl` Agent tool
- View and materialized view generation
- Triggers and stored procedures
- CHECK expressions
- General, partial or expression indexes
- User-defined enum and domain types
- Partitions
- Database permissions and RLS
- Arbitrary SQL default expressions
- Table or column comment round-trip support
- Agent replacement of legacy `snapshot` sessions
- Multi-tool, long-running workflow orchestration

Table and column comment fields exist in modelJson, but the current frontend DDL
parser and model-to-SQL path do not round-trip them. Comment support must be a
separate parser, renderer and model-to-SQL contract change.

## 4. Proposed tool definition

```ts
type GenerateSqlErdToolDefinition = {
  name: "generate_sql_erd";
  riskLevel: "medium";
  executionMode: "contextual";
  input: SqlErdSchemaSpecV1;
};
```

The public input must not contain `workspaceId`, `sessionId`, `currentUserId`,
`requestedByUserId`, `targetMode` or a source-lock lease. Identity and target
values come only from authenticated server context and a stored choice plan.

## 5. SqlErdSchemaSpecV1

```ts
type SqlErdSchemaSpecV1 = {
  version: 1;
  title: string;
  requestedDialect: "postgresql" | "mysql" | "sqlite" | null;
  tables: SqlErdSchemaTableSpec[];
  relations: SqlErdSchemaRelationSpec[];
  unsupportedFeatures: SqlErdUnsupportedFeature[];
};

type SqlErdUnsupportedFeature =
  | "views"
  | "triggers"
  | "stored_procedures"
  | "check_constraints"
  | "indexes"
  | "enums"
  | "partitions"
  | "permissions_rls"
  | "database_execution"
  | "comments"
  | "raw_default_expressions";

type SqlErdSchemaTableSpec = {
  key: string;
  name: string;
  schemaName: string | null;
  columns: SqlErdSchemaColumnSpec[];
  primaryKey: SqlErdSchemaKeyConstraintSpec | null;
  uniqueConstraints: SqlErdSchemaKeyConstraintSpec[];
};

type SqlErdSchemaColumnSpec = {
  key: string;
  name: string;
  dataType: SqlErdSchemaDataTypeSpec;
  nullable: boolean;
  autoIncrement: boolean;
  defaultValue: SqlErdSchemaDefaultSpec | null;
};

type SqlErdSchemaDataTypeSpec = {
  kind:
    | "boolean"
    | "smallint"
    | "integer"
    | "bigint"
    | "decimal"
    | "real"
    | "double"
    | "char"
    | "varchar"
    | "text"
    | "date"
    | "time"
    | "timestamp"
    | "timestamp_tz"
    | "uuid"
    | "json"
    | "binary";
  length: number | null;
  precision: number | null;
  scale: number | null;
};

type SqlErdSchemaDefaultSpec =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "current_date"; value: null }
  | { kind: "current_timestamp"; value: null };

type SqlErdSchemaKeyConstraintSpec = {
  name: string | null;
  columnKeys: string[];
};

type SqlErdSchemaRelationSpec = {
  key: string;
  name: string | null;
  fromTableKey: string;
  fromColumnKeys: string[];
  toTableKey: string;
  toColumnKeys: string[];
};
```

Every object in the public JSON Schema uses `additionalProperties: false`.
`key` values are tool-local references and are never persisted as resource
identity.

## 6. Validation and size limits

The App Server validates the AI Worker output again before generating DDL or
opening a transaction.

| Field | Limit |
| --- | --- |
| serialized schemaSpec | UTF-8 maximum 48 KiB |
| title | 1..120 characters |
| tables | 1..100 |
| all columns | maximum 1,000 |
| columns per table | maximum 200 |
| relations | maximum 300 |
| identifier | maximum 256 characters |
| generated sourceText | UTF-8 maximum 1 MiB |
| generated modelJson | serialized UTF-8 maximum 1 MiB |
| generated layoutJson | serialized UTF-8 maximum 1 MiB |
| persisted source snapshot total | maximum 3 MiB |

The 48 KiB Agent-specific limit keeps schemaSpec plus confirmation metadata
within the current `agent_confirmations.plan_json` 64 KiB limit. Generated
SQLtoERD values are checked separately against the existing domain limits.

Validation includes:

- unique table names within a schema;
- unique column names within a table;
- unique tool-local table, column and relation keys;
- non-empty PK, UK and FK column lists;
- valid constraint and relation references;
- matching composite FK column counts;
- type-specific length, precision and scale;
- `0 < length <= 65535`;
- `1 <= precision <= 1000` and `0 <= scale <= precision`;
- auto increment only on a single integer primary-key column;
- default literal compatibility with the column type;
- no `schemaName` for SQLite;
- no arbitrary raw data type or SQL default expression.

If a request contains only unsupported features and no supported table can be
produced, the run completes as unsupported without creating a session. For a
mixed request, supported content may be generated and bounded
`unsupportedFeatures` codes are returned. Unsupported requirements must not be
silently omitted.

## 7. Deterministic generation

The App Server generator produces DDL and modelJson from the same validated
schemaSpec. The DDL uses only syntax supported by the existing frontend parser.
Golden and round-trip fixtures cover PostgreSQL, MySQL and SQLite.

The model uses the existing frontend parser identity rules:

- table: existing `table.<qualified-name>` rule;
- column: existing `column.<qualified-table>.<column-name>` rule;
- PK and UK: existing parser constraint ID rules;
- FK: existing legacy/v2 hashed `createSqltoerdForeignKeyRelationId` rule.

This parity is required for current-session position preservation.

New-session layout uses `@dagrejs/dagre`. Current-session replacement does not
run full auto-layout because that would move retained tables. It uses the
existing server `rebaseSqlErdSourceLayout` helper to preserve retained layouts,
place new tables deterministically and remove stale references.

Portable type mappings include:

| Logical type | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| `json` | `JSONB` | `JSON` | `TEXT` |
| `uuid` | `UUID` | `CHAR(36)` | `TEXT` |
| `timestamp_tz` | `TIMESTAMPTZ` | `TIMESTAMP` | `TIMESTAMP` |

MySQL and SQLite `timestamp_tz` output records a bounded portability downgrade
warning.

## 8. Proposed Agent run context

The create-run request gains one optional bounded context:

```ts
type AgentRunRequestContext =
  | { surface: "sql_erd"; sessionId: string }
  | null;
```

- The frontend sends neither dialect nor revision nor writeProtocol.
- The App Server re-reads and authorizes the session in the current workspace.
- The context is snapshotted at run submission and remains unchanged if the
  browser navigates while the run is pending.
- `agent_runs.request_context_json` stores the context for async execution and
  retry. It accepts an object or null and is limited to 2 KiB.

## 9. Proposed contextual execution

```ts
type AgentToolExecutionMode =
  | "auto"
  | "confirmation_required"
  | "contextual";
```

A contextual definition has a server-side `prepareExecution` function:

- no SQLtoERD context -> execute immediately;
- authorized SQLtoERD context -> create choice confirmation;
- no safe target -> return bounded clarification or unsupported result.

The planner candidate `requiresConfirmation` becomes `boolean | null`:

- `auto` -> `false`
- `confirmation_required` -> `true`
- `contextual` -> `null`

The AI Worker does not decide whether a contextual tool executes automatically
or creates a choice. The App Server resolves it from stored request context.

## 10. Proposed choice confirmation

Existing confirmation plans remain backward compatible. A plan without `kind`
is treated as the existing approval shape.

```ts
type GenerateSqlErdChoicePlan = {
  kind: "choice";
  toolName: "generate_sql_erd";
  summary: string;
  target: {
    domain: "sqltoerd";
    resourceType: "session_target";
  };
  call: {
    schemaSpec: SqlErdSchemaSpecV1;
    currentSessionId: string;
  };
  choices: Array<{
    id: "new_session" | "replace_current";
    label: string;
    description: string;
  }>;
};
```

schemaSpec is stored once in `call`, not copied into each choice.

The existing approve endpoint accepts an optional body:

```http
POST /api/v1/workspaces/{workspaceId}/agent/runs/{runId}/confirmations/{confirmationId}/approve
Content-Type: application/json

{ "choiceId": "replace_current" }
```

- Existing approval plans continue to use an empty body.
- Choice plans require one stored choice ID.
- The client never resubmits sessionId, schemaSpec or execution payload.
- The server stores `selected_choice_id` atomically with approval metadata.
- The existing reject endpoint implements Cancel.

## 11. Persistence and concurrency

### 11.1 New session

The adapter calls the SQLtoERD domain service rather than issuing SQL directly.
The server assigns workspace, actor, session ID and the current feature-flag
writeProtocol. The response returns the created session.

New-session retry uses a domain idempotency record keyed by
`(workspaceId, actorUserId, agentRunId)`. The record stores a request
fingerprint and the created session ID in the same transaction. A repeated key
with a different fingerprint is a conflict.

### 11.2 Current operations_v1 session

The SQLtoERD domain transaction performs:

1. Workspace access check
2. Session row `FOR UPDATE`
3. Active `operations_v1` validation
4. Active source-lock absence check
5. Dialect conflict check
6. Rebase against the latest server layout
7. Immutable source snapshot insert
8. Session source/model/layout/revision/latestOpSeq update
9. `source_snapshot` operation insert
10. Operation outbox insert

This is a server-internal SQLtoERD domain mutation. It must reuse the existing
source snapshot, operation and outbox persistence helpers, but it does not call
the public user-editor publish endpoint that requires an owned lease ID.

Source-lock acquire also locks the session row, so lock acquisition and Agent
replacement are serialized. The Agent never impersonates, releases or reuses a
user editor lease.

Current replacement derives `clientOperationId` deterministically from the
Agent run and reuses the existing unique
`(sessionId, actorUserId, clientOperationId)` operation contract.

## 12. Tool output and resource link

`outputSummary` is bounded to:

- status
- session title
- resolved dialect
- table count
- relation count
- unsupported or portability warning codes

The complete DDL and schemaSpec are not copied into Agent output, logs or final
messages.

```json
{
  "domain": "sqltoerd",
  "resourceType": "session",
  "resourceId": "<server-created UUID>",
  "label": "Commerce ERD",
  "url": "/sql-erd/session?sessionId=<encoded UUID>",
  "metadata": {
    "dialect": "postgresql",
    "tableCount": 6,
    "relationCount": 5
  }
}
```

The frontend renders only allowlisted relative application URLs. External,
protocol-relative and `javascript:` URLs are not rendered as tool links.

## 13. Failure behavior

| Condition | Result |
| --- | --- |
| Invalid schemaSpec | Validation failure; no session |
| Duplicate name or broken reference | Validation failure with bounded field/key context |
| Generated payload over domain limit | Payload-too-large tool failure; no write |
| Unauthorized or missing current session | Forbidden/not-found; no write |
| Current session is `snapshot` | Replace rejected; offer new session |
| Explicit dialect conflicts with current session | Replace rejected; offer new session |
| Active source lock | Replace rejected; close Source editor or create new session |
| Choice expired | Existing `CONFIRMATION_EXPIRED` behavior |
| Current session deleted after planning | Not found; request a new run |
| AI provider failure | Safe Agent error without raw provider payload |
| Broadcast delayed after commit | DB result remains committed; existing outbox retries |

No failure path may persist sourceText without the matching modelJson and
layoutJson, or persist a partial source snapshot/operation/outbox set.

## 14. Security and audit rules

- Treat schemaSpec as untrusted AI output.
- Validate with public JSON Schema and App Server domain validation.
- Never accept workspace, actor, session or target identity from public tool
  input.
- Never execute generated DDL.
- Do not include prompt, full schemaSpec or DDL in provider error logs.
- Execute only the server-stored choice plan and choice ID.
- Recheck workspace access, session state, dialect and source lock at execution.
- Keep Agent output and resource metadata bounded.
- Record only bounded generation metadata in the applicable activity/audit
  contract.

## 15. Proposed DB changes

One implementation migration is expected to add:

- nullable `agent_runs.request_context_json` with object/type and 2 KiB checks;
- nullable `agent_confirmations.selected_choice_id` with length/state checks;
- `sql_erd_agent_session_creations` with unique
  `(workspace_id, actor_user_id, agent_run_id)`, request fingerprint and
  resulting session ID.

These are proposed DB changes only. They require DB Schema owner review and do
not exist when this document is merged.

## 16. Implementation PR boundaries

### PR 1: Agent contextual execution foundation

- request context DB/API
- contextual execution mode
- choice confirmation DB/API/UI foundation
- existing Agent tool regression tests

Independent completion: a fixture tool proves global auto execution and
page-context choice execution without SQLtoERD-specific generation.

### PR 2: SQLtoERD generator and domain mutation

- schemaSpec validation
- deterministic DDL/model/layout
- frontend/server identity parity fixtures
- new-session idempotency
- operations_v1 source snapshot replacement

Independent completion: service tests create a session and replace a current
session without the Agent adapter.

### PR 3: generate_sql_erd tool and AI Worker

- SQLtoERD Agent adapter and registry/module wiring
- AI Worker schema planning, prompt and eval coverage
- bounded output and SQLtoERD resource refs

Independent completion: Agent API runs create a new session globally and
produce a choice inside SQLtoERD context.

### PR 4: Frontend integration and E2E

- SQLtoERD page-context registration
- choice UX and resource-link rendering
- two-browser operations_v1 source snapshot verification
- complete API documentation promotion

Independent completion: a user creates and opens an ERD from the common Agent
chat and safely replaces a collaborative current session.

## 17. Review and activation gates

Required review areas:

- SQLtoERD owner: schema/model identity, dialect and source replacement
- DB Schema owner: request context, choice selection and idempotency schema
- Agent owner: contextual execution and backward compatibility
- Frontend common-area reviewers: workspace provider, confirmation and link UI
- AI Worker reviewers: structured schema quality and regression evals

Activation is blocked until all four implementation PR boundaries are complete,
the root Agent and SQLtoERD API documents match the implementation, and the
two-browser E2E passes. Merging this proposed document alone activates nothing.
