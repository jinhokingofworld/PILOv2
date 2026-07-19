import { Injectable } from "@nestjs/common";
import { badRequest, conflict } from "../../../common/api-error";
import type {
  SqlErdSchemaGenerationWarning,
  SqlErdSchemaSpecV1
} from "../../sql-erd/sql-erd-schema-spec.types";
import { validateSqlErdSchemaSpec } from "../../sql-erd/sql-erd-schema-spec.validation";
import { SqlErdService } from "../../sql-erd/sql-erd.service";
import type { SqlErdSessionPayload } from "../../sql-erd/sql-erd.types";
import type {
  AgentChoiceConfirmationPlan,
  AgentConfirmationPlan,
  AgentJsonObject,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolExecutionResult,
  AgentToolInputSchema
} from "../types/agent-tool.types";
import { parseSqlErdSessionCandidates } from "../sql-erd-session-selection";
import {
  buildSqlErdAgentSchemaProjection,
  createSqlErdModelFingerprint,
  partitionSqlErdAgentContextTableRefs,
  type SqlErdAgentContextEvidence,
  resolveSqlErdAgentTableFocus
} from "./sql-erd-table-focus";

type SqlErdAgentTargetMode = "new_session" | "replace_current";

interface ConfirmedSqlErdAgentInput {
  currentSessionId: string;
  schemaSpec: SqlErdSchemaSpecV1;
  targetMode: SqlErdAgentTargetMode;
  expectedSessionRevision?: number;
  expectedModelFingerprint?: string;
}

interface InspectSqlErdSchemaInput {
  featureQuery: string;
  sessionId?: string;
  sessionSelectionToken?: string;
  sessionTitle?: string;
}

interface FocusSqlErdReason {
  tableRef: string;
  reason: string;
  evidence?: SqlErdAgentContextEvidence[];
}

interface FocusSqlErdTablesInput {
  sessionId: string;
  sessionRevision: number;
  modelFingerprint: string;
  featureLabel: string;
  primaryTableRefs: string[];
  relatedTableRefs: string[];
  contextTableRefs: string[];
  confidence: "high" | "medium" | "low";
  reasons: FocusSqlErdReason[];
}

type SqlErdSessionCandidate = {
  id: string;
  title: string;
  updatedAt: string;
  tableCount: number;
  relationCount: number;
};

type SqlErdSessionResolution =
  | { kind: "selected"; session: SqlErdSessionPayload }
  | {
      kind: "clarification";
      reason: "no_sessions" | "multiple_sessions" | "session_title_not_found";
      candidates: SqlErdSessionCandidate[];
    };

const TARGET_MODES: SqlErdAgentTargetMode[] = [
  "new_session",
  "replace_current"
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE_REF_PATTERN = /^t[1-9][0-9]*$/;
const MODEL_FINGERPRINT_PATTERN = /^fnv1a32:[0-9a-f]{8}$/;
const FOCUS_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
const MAX_PRIMARY_TABLES = 20;
const MAX_RELATED_TABLES = 30;
const MAX_CONTEXT_TABLES = 20;
const MAX_CONTEXT_EVIDENCE_ITEMS = 5;
const MAX_FOCUS_REASONS =
  MAX_PRIMARY_TABLES + MAX_RELATED_TABLES + MAX_CONTEXT_TABLES;
const CONTEXT_EVIDENCE_KINDS = [
  "table_name",
  "table_comment",
  "column_name",
  "column_comment",
  "data_type",
  "enum_value"
] as const;

const INSPECT_SQL_ERD_INPUT_SCHEMA: AgentToolInputSchema = {
  type: "object",
  required: ["featureQuery"],
  additionalProperties: false,
  properties: {
    featureQuery: { type: "string", minLength: 1, maxLength: 200 },
    sessionId: { type: "string", format: "uuid" },
    sessionSelectionToken: { type: "string", format: "uuid" },
    sessionTitle: { type: "string", minLength: 1, maxLength: 120 }
  }
};

const FOCUS_SQL_ERD_INPUT_SCHEMA: AgentToolInputSchema = {
  type: "object",
  required: [
    "sessionId",
    "sessionRevision",
    "modelFingerprint",
    "featureLabel",
    "primaryTableRefs",
    "relatedTableRefs",
    "contextTableRefs",
    "confidence",
    "reasons"
  ],
  additionalProperties: false,
  properties: {
    sessionId: { type: "string", format: "uuid" },
    sessionRevision: { type: "integer", minimum: 1 },
    modelFingerprint: {
      type: "string",
      pattern: "^fnv1a32:[0-9a-f]{8}$"
    },
    featureLabel: { type: "string", minLength: 1, maxLength: 100 },
    primaryTableRefs: {
      type: "array",
      minItems: 1,
      maxItems: MAX_PRIMARY_TABLES,
      uniqueItems: true,
      items: { type: "string", pattern: "^t[1-9][0-9]*$" }
    },
    relatedTableRefs: {
      type: "array",
      maxItems: MAX_RELATED_TABLES,
      uniqueItems: true,
      items: { type: "string", pattern: "^t[1-9][0-9]*$" }
    },
    contextTableRefs: {
      type: "array",
      maxItems: MAX_CONTEXT_TABLES,
      uniqueItems: true,
      items: { type: "string", pattern: "^t[1-9][0-9]*$" }
    },
    confidence: { type: "string", enum: [...FOCUS_CONFIDENCE_VALUES] },
    reasons: {
      type: "array",
      minItems: 1,
      maxItems: MAX_FOCUS_REASONS,
      items: {
        type: "object",
        required: ["tableRef", "reason"],
        additionalProperties: false,
        properties: {
          tableRef: { type: "string", pattern: "^t[1-9][0-9]*$" },
          reason: { type: "string", minLength: 1, maxLength: 240 },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: MAX_CONTEXT_EVIDENCE_ITEMS,
            items: {
              type: "object",
              required: ["kind", "value"],
              additionalProperties: false,
              properties: {
                kind: { type: "string", enum: [...CONTEXT_EVIDENCE_KINDS] },
                columnName: { type: "string", minLength: 1, maxLength: 80 },
                value: { type: "string", minLength: 1, maxLength: 240 }
              }
            }
          }
        }
      }
    }
  }
};
const SQL_ERD_SCHEMA_SPEC_INPUT_SCHEMA: AgentToolInputSchema = {
  type: "object",
  required: [
    "version",
    "title",
    "requestedDialect",
    "tables",
    "relations",
    "unsupportedFeatures"
  ],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    title: { type: "string", minLength: 1, maxLength: 120 },
    requestedDialect: {
      type: ["string", "null"],
      enum: ["postgresql", "mysql", "sqlite", null]
    },
    tables: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { $ref: "#/$defs/table" }
    },
    relations: {
      type: "array",
      maxItems: 300,
      items: { $ref: "#/$defs/relation" }
    },
    unsupportedFeatures: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "string",
        enum: [
          "check_constraints",
          "comments",
          "database_execution",
          "enums",
          "indexes",
          "partitions",
          "permissions_rls",
          "raw_default_expressions",
          "stored_procedures",
          "triggers",
          "views"
        ]
      }
    }
  },
  $defs: {
    dataType: {
      type: "object",
      required: ["kind", "length", "precision", "scale"],
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: [
            "bigint",
            "binary",
            "boolean",
            "char",
            "date",
            "decimal",
            "double",
            "integer",
            "json",
            "real",
            "smallint",
            "text",
            "time",
            "timestamp",
            "timestamp_tz",
            "uuid",
            "varchar"
          ]
        },
        length: { type: ["integer", "null"], minimum: 1 },
        precision: { type: ["integer", "null"], minimum: 1 },
        scale: { type: ["integer", "null"], minimum: 0 }
      }
    },
    defaultValue: {
      type: ["object", "null"],
      required: ["kind", "value"],
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["current_date", "current_timestamp", "literal"]
        },
        value: { type: ["string", "number", "boolean", "null"] }
      }
    },
    column: {
      type: "object",
      required: [
        "key",
        "name",
        "dataType",
        "nullable",
        "autoIncrement",
        "defaultValue"
      ],
      additionalProperties: false,
      properties: {
        key: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
        dataType: { $ref: "#/$defs/dataType" },
        nullable: { type: "boolean" },
        autoIncrement: { type: "boolean" },
        defaultValue: { $ref: "#/$defs/defaultValue" }
      }
    },
    keyConstraint: {
      type: "object",
      required: ["name", "columnKeys"],
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"], maxLength: 256 },
        columnKeys: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 256 }
        }
      }
    },
    table: {
      type: "object",
      required: [
        "key",
        "name",
        "schemaName",
        "columns",
        "primaryKey",
        "uniqueConstraints"
      ],
      additionalProperties: false,
      properties: {
        key: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
        schemaName: { type: ["string", "null"], maxLength: 256 },
        columns: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: { $ref: "#/$defs/column" }
        },
        primaryKey: {
          oneOf: [{ $ref: "#/$defs/keyConstraint" }, { type: "null" }]
        },
        uniqueConstraints: {
          type: "array",
          maxItems: 200,
          items: { $ref: "#/$defs/keyConstraint" }
        }
      }
    },
    relation: {
      type: "object",
      required: [
        "key",
        "name",
        "fromTableKey",
        "fromColumnKeys",
        "toTableKey",
        "toColumnKeys"
      ],
      additionalProperties: false,
      properties: {
        key: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: ["string", "null"], maxLength: 256 },
        fromTableKey: { type: "string", minLength: 1, maxLength: 256 },
        fromColumnKeys: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1, maxLength: 256 }
        },
        toTableKey: { type: "string", minLength: 1, maxLength: 256 },
        toColumnKeys: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1, maxLength: 256 }
        }
      }
    }
  }
};

@Injectable()
export class SqlErdAgentToolsService {
  constructor(private readonly sqlErdService: SqlErdService) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [
      this.generateSqlErdDefinition(),
      this.inspectSqlErdSchemaDefinition(),
      this.focusSqlErdTablesDefinition()
    ];
  }

  private inspectSqlErdSchemaDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "inspect_sql_erd_schema",
      description:
        "Workspace SQLtoERD session의 테이블 이름, 주요 컬럼, data type, 제한된 enum 값과 FK 관계를 projection으로 조회합니다. 기능 관련 테이블을 찾을 때 반드시 먼저 사용하며 session이 여러 개면 사용자가 선택할 후보를 반환합니다.",
      riskLevel: "low",
      executionMode: "contextual",
      inputSchema: INSPECT_SQL_ERD_INPUT_SCHEMA,
      validateInput: (input) => this.validateInspectInput(input),
      prepareExecution: (context, input) =>
        this.prepareInspect(context, this.validateInspectInput(input)),
      execute: (context, input) =>
        this.executeInspect(context, this.validateInspectInput(input))
    };
  }

  private focusSqlErdTablesDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "focus_sql_erd_tables",
      description:
        "inspect_sql_erd_schema 결과의 compact table ref와 schema evidence를 model fingerprint로 검증하고 핵심, 직접 FK 관련 및 문맥 테이블의 일회성 집중 보기 링크를 만듭니다. SQLtoERD session과 실제 관계선은 변경하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      postExecutionDisposition: "complete_run",
      inputSchema: FOCUS_SQL_ERD_INPUT_SCHEMA,
      validateInput: (input) => this.validateFocusInput(input),
      execute: (context, input) =>
        this.executeFocus(context, this.validateFocusInput(input))
    };
  }

  private generateSqlErdDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "generate_sql_erd",
      description:
        "자연어 요구사항을 구조화한 SqlErdSchemaSpecV1으로 SQL DDL과 ERD를 생성합니다. 완성된 DDL 문자열이 아니라 전체 schemaSpec을 전달해야 하며, 실제 데이터베이스에는 실행하지 않습니다.",
      riskLevel: "medium",
      executionMode: "contextual",
      inputSchema: SQL_ERD_SCHEMA_SPEC_INPUT_SCHEMA,
      validateInput: (input) => validateSqlErdSchemaSpec(input),
      prepareExecution: (context, input) =>
        this.prepareGenerate(context, validateSqlErdSchemaSpec(input)),
      buildConfirmationInput: (plan, selectedChoiceId) =>
        this.buildChoiceInput(plan, selectedChoiceId),
      validateConfirmationInput: (input) =>
        this.validateConfirmedInput(input),
      execute: (context, input) => this.executeGenerate(context, input)
    };
  }

  private async prepareGenerate(
    context: AgentToolContext,
    schemaSpec: SqlErdSchemaSpecV1
  ) {
    if (context.requestContext?.surface !== "sql_erd") {
      return { kind: "execute" as const };
    }

    const session = await this.sqlErdService.getSession(
      context.currentUserId,
      context.workspaceId,
      context.requestContext.sessionId
    );
    const choices: AgentChoiceConfirmationPlan["choices"] = [
      {
        id: "new_session",
        label: "새 세션 만들기",
        description: "현재 세션을 유지하고 생성 결과를 새 세션에 저장합니다.",
        input: { targetMode: "new_session" }
      }
    ];
    if (session.writeProtocol === "operations_v1") {
      choices.push({
        id: "replace_current",
        label: "현재 스키마 교체",
        description:
          "현재 세션의 제목과 레이아웃 호환 요소는 유지하고 스키마를 교체합니다.",
        input: { targetMode: "replace_current" }
      });
    }

    return {
      kind: "confirmation" as const,
      plan: {
        kind: "choice" as const,
        toolName: "generate_sql_erd",
        summary:
          session.writeProtocol === "operations_v1"
            ? "생성한 스키마를 어디에 적용할지 선택해주세요."
            : "현재 세션은 스키마 교체를 지원하지 않습니다. 생성 결과를 새 세션에 저장할 수 있습니다.",
        target: {
          domain: "sqltoerd",
          resourceType: "session",
          resourceId: session.id
        },
        call: {
          schemaSpec: this.toAgentJsonObject(schemaSpec),
          currentSessionId: session.id,
          expectedSessionRevision: session.revision,
          expectedModelFingerprint: createSqlErdModelFingerprint(
            session.modelJson
          )
        },
        choices
      }
    };
  }

  private buildChoiceInput(
    plan: AgentConfirmationPlan,
    selectedChoiceId?: string | null
  ): ConfirmedSqlErdAgentInput {
    if (plan.kind !== "choice" || plan.toolName !== "generate_sql_erd") {
      throw badRequest("generate_sql_erd choice confirmation is invalid");
    }
    const choice = plan.choices.find((item) => item.id === selectedChoiceId);
    if (!choice) {
      throw badRequest("generate_sql_erd choice is invalid");
    }

    return this.validateConfirmedInput({
      ...plan.call,
      ...choice.input
    });
  }

  private validateConfirmedInput(input: unknown): ConfirmedSqlErdAgentInput {
    if (!this.isPlainObject(input)) {
      throw badRequest("generate_sql_erd confirmation input is invalid");
    }
    const allowedFields = [
      "schemaSpec",
      "currentSessionId",
      "targetMode",
      "expectedSessionRevision",
      "expectedModelFingerprint"
    ];
    const unexpected = Object.keys(input).find(
      (field) => !allowedFields.includes(field)
    );
    if (unexpected) {
      throw badRequest(`generate_sql_erd confirmation field is invalid: ${unexpected}`);
    }
    if (
      typeof input.currentSessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.currentSessionId
      )
    ) {
      throw badRequest("generate_sql_erd currentSessionId is invalid");
    }
    if (!TARGET_MODES.includes(input.targetMode as SqlErdAgentTargetMode)) {
      throw badRequest("generate_sql_erd target mode is invalid");
    }
    const targetMode = input.targetMode as SqlErdAgentTargetMode;
    const expectedSessionRevision =
      typeof input.expectedSessionRevision === "number"
        ? input.expectedSessionRevision
        : undefined;
    if (
      input.expectedSessionRevision !== undefined &&
      (expectedSessionRevision === undefined ||
        !Number.isInteger(expectedSessionRevision) ||
        expectedSessionRevision < 1)
    ) {
      throw badRequest("generate_sql_erd expected session revision is invalid");
    }
    const expectedModelFingerprint =
      typeof input.expectedModelFingerprint === "string"
        ? input.expectedModelFingerprint
        : undefined;
    if (
      input.expectedModelFingerprint !== undefined &&
      (expectedModelFingerprint === undefined ||
        !MODEL_FINGERPRINT_PATTERN.test(expectedModelFingerprint))
    ) {
      throw badRequest("generate_sql_erd expected model fingerprint is invalid");
    }
    if (
      targetMode === "replace_current" &&
      (expectedSessionRevision === undefined ||
        expectedModelFingerprint === undefined)
    ) {
      throw badRequest(
        "generate_sql_erd replace confirmation is stale; inspect the schema again"
      );
    }

    return {
      currentSessionId: input.currentSessionId,
      schemaSpec: validateSqlErdSchemaSpec(input.schemaSpec),
      targetMode,
      ...(expectedSessionRevision === undefined
        ? {}
        : { expectedSessionRevision }),
      ...(expectedModelFingerprint === undefined
        ? {}
        : { expectedModelFingerprint })
    };
  }

  private async prepareInspect(
    context: AgentToolContext,
    input: InspectSqlErdSchemaInput
  ) {
    const resolution = await this.resolveInspectSession(context, input);
    if (resolution.kind === "selected") {
      return { kind: "execute" as const };
    }

    return {
      kind: "needs_clarification" as const,
      outputSummary: this.toAgentJsonObject({
        status: "needs_clarification",
        reason: resolution.reason,
        question: this.inspectClarificationQuestion(
          resolution.reason,
          resolution.candidates
        ),
        candidates: resolution.candidates.map((candidate) => ({
          title: candidate.title,
          updatedAt: candidate.updatedAt,
          tableCount: candidate.tableCount,
          relationCount: candidate.relationCount
        }))
      }),
      resourceRefs: [],
      candidateResources: resolution.candidates.map((candidate) => ({
        reference: {
          domain: "sqltoerd",
          resourceType: "session",
          resourceId: candidate.id
        },
        candidate: {
          resourceType: "session",
          label: candidate.title,
          description: `수정 ${candidate.updatedAt} · 테이블 ${candidate.tableCount}개 · 관계 ${candidate.relationCount}개`,
          status: null
        }
      }))
    };
  }

  private async executeInspect(
    context: AgentToolContext,
    input: InspectSqlErdSchemaInput
  ): Promise<AgentToolExecutionResult> {
    const resolution = await this.resolveInspectSession(context, input);
    if (resolution.kind !== "selected") {
      throw badRequest("SQLtoERD session selection requires clarification");
    }
    const { session } = resolution;
    const projection = buildSqlErdAgentSchemaProjection(
      session.modelJson,
      input.featureQuery,
      session.sourceText
    );
    const modelFingerprint = createSqlErdModelFingerprint(session.modelJson);
    return {
      outputSummary: this.toAgentJsonObject({
        sessionId: session.id,
        sessionRevision: session.revision,
        modelFingerprint,
        title: session.title,
        dialect: session.dialect,
        tableCount: session.tableCount,
        relationCount: session.relationCount,
        projection
      }),
      resourceRefs: []
    };
  }

  private async executeFocus(
    context: AgentToolContext,
    input: FocusSqlErdTablesInput
  ): Promise<AgentToolExecutionResult> {
    const session = await this.sqlErdService.getSession(
      context.currentUserId,
      context.workspaceId,
      input.sessionId
    );
    const modelFingerprint = createSqlErdModelFingerprint(session.modelJson);
    if (modelFingerprint !== input.modelFingerprint) {
      throw conflict("SQLtoERD model changed; inspect the schema again");
    }
    const reasonByRef = new Map(
      input.reasons.map((item) => [item.tableRef, item.reason])
    );
    const evidenceByRef = new Map(
      input.reasons.map((item) => [item.tableRef, item.evidence ?? []])
    );
    resolveSqlErdAgentTableFocus(session.modelJson, input);
    const contextEvidence = partitionSqlErdAgentContextTableRefs(
      session.modelJson,
      session.sourceText,
      evidenceByRef,
      input.contextTableRefs
    );
    const resolved = resolveSqlErdAgentTableFocus(session.modelJson, {
      ...input,
      contextTableRefs: contextEvidence.acceptedRefs
    });
    const primaryTables = resolved.tables
      .filter((table) => table.role === "primary")
      .map((table) => ({
        name: table.name,
        reason: reasonByRef.get(table.ref) ?? ""
      }));
    const relatedTables = resolved.tables
      .filter((table) => table.role === "related")
      .map((table) => ({
        name: table.name,
        reason: reasonByRef.get(table.ref) ?? ""
      }));
    const contextTables = resolved.tables
      .filter((table) => table.role === "context")
      .map((table) => ({
        name: table.name,
        reason: reasonByRef.get(table.ref) ?? ""
      }));

    return {
      outputSummary: this.toAgentJsonObject({
        action: "focused",
        sessionId: session.id,
        sessionRevision: session.revision,
        modelFingerprint,
        title: session.title,
        featureLabel: input.featureLabel,
        confidence: input.confidence,
        primaryTables,
        relatedTables,
        contextTables,
        ignoredContextTables: contextEvidence.ignoredTables.map((table) => ({
          name: table.name,
          reason: table.reason
        })),
        relationCount: resolved.relationIds.length
      }),
      resourceRefs: [
        {
          domain: "sqltoerd",
          resourceType: "session",
          resourceId: session.id,
          label: session.title,
          url: `/sql-erd/session?sessionId=${encodeURIComponent(session.id)}`,
          status: "focused",
          metadata: {
            version: 1,
            view: "table_focus",
            sessionRevision: session.revision,
            modelFingerprint,
            featureLabel: input.featureLabel,
            primaryTableIds: resolved.primaryTableIds,
            relatedTableIds: resolved.relatedTableIds,
            contextTableIds: resolved.contextTableIds,
            relationIds: resolved.relationIds,
            confidence: input.confidence
          }
        }
      ],
      status: "focused"
    };
  }

  private async resolveInspectSession(
    context: AgentToolContext,
    input: InspectSqlErdSchemaInput
  ): Promise<SqlErdSessionResolution> {
    if (input.sessionId) {
      return {
        kind: "selected",
        session: await this.sqlErdService.getSession(
          context.currentUserId,
          context.workspaceId,
          input.sessionId
        )
      };
    }

    if (input.sessionSelectionToken) {
      return {
        kind: "selected",
        session: await this.sqlErdService.getSession(
          context.currentUserId,
          context.workspaceId,
          input.sessionSelectionToken
        )
      };
    }

    const sessions = await this.sqlErdService.listSessions(
      context.currentUserId,
      context.workspaceId,
      { limit: 100 }
    );
    if (input.sessionTitle) {
      const matches = sessions.items.filter(
        (session) => session.title === input.sessionTitle
      );
      if (matches.length === 1) {
        return {
          kind: "selected",
          session: await this.sqlErdService.getSession(
            context.currentUserId,
            context.workspaceId,
            matches[0].id
          )
        };
      }
      return {
        kind: "clarification",
        reason:
          matches.length > 1
            ? "multiple_sessions"
            : "session_title_not_found",
        candidates: this.toSessionCandidates(
          matches.length > 1 ? matches : sessions.items
        )
      };
    }

    if (context.requestContext?.surface === "sql_erd") {
      return {
        kind: "selected",
        session: await this.sqlErdService.getSession(
          context.currentUserId,
          context.workspaceId,
          context.requestContext.sessionId
        )
      };
    }
    if (sessions.items.length === 1) {
      return {
        kind: "selected",
        session: await this.sqlErdService.getSession(
          context.currentUserId,
          context.workspaceId,
          sessions.items[0].id
        )
      };
    }
    return {
      kind: "clarification",
      reason:
        sessions.items.length === 0 ? "no_sessions" : "multiple_sessions",
      candidates: this.toSessionCandidates(sessions.items)
    };
  }

  private toSessionCandidates(
    sessions: Array<{
      id: string;
      title: string;
      updatedAt: string;
      tableCount: number;
      relationCount: number;
    }>
  ): SqlErdSessionCandidate[] {
    return parseSqlErdSessionCandidates(
      sessions.slice(0, 5).map((session) => ({
        selectionToken: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        tableCount: session.tableCount,
        relationCount: session.relationCount
      }))
    ).map((candidate) => ({
      id: candidate.selectionToken,
      title: candidate.title,
      updatedAt: candidate.updatedAt,
      tableCount: candidate.tableCount,
      relationCount: candidate.relationCount
    }));
  }

  private inspectClarificationQuestion(
    reason: "no_sessions" | "multiple_sessions" | "session_title_not_found",
    candidates: SqlErdSessionCandidate[]
  ): string {
    if (reason === "no_sessions") {
      return "분석할 SQLtoERD 세션이 없습니다. 먼저 세션을 만들어 주세요.";
    }
    const question =
      reason === "session_title_not_found"
        ? "요청한 제목의 SQLtoERD 세션을 찾지 못했습니다. 사용할 세션을 선택해 주세요."
        : "분석할 SQLtoERD 세션이 여러 개입니다. 사용할 세션을 선택해 주세요.";
    return [
      question,
      ...candidates.map(
        (candidate, index) =>
          `${index + 1}. ${candidate.title} · 수정 ${candidate.updatedAt} · 테이블 ${candidate.tableCount}개 · 관계 ${candidate.relationCount}개`
      )
    ].join("\n");
  }

  private validateInspectInput(input: unknown): InspectSqlErdSchemaInput {
    if (!this.isPlainObject(input)) {
      throw badRequest("inspect_sql_erd_schema input must be an object");
    }
    this.assertAllowedFields(
      input,
      [
        "featureQuery",
        "sessionId",
        "sessionSelectionToken",
        "sessionTitle"
      ],
      "inspect_sql_erd_schema"
    );
    const featureQuery = this.readBoundedText(
      input.featureQuery,
      200,
      "featureQuery"
    );
    const sessionId =
      input.sessionId === undefined
        ? undefined
        : this.readUuid(input.sessionId, "sessionId");
    const sessionTitle =
      input.sessionTitle === undefined
        ? undefined
        : this.readBoundedText(input.sessionTitle, 120, "sessionTitle");
    const sessionSelectionToken =
      input.sessionSelectionToken === undefined
        ? undefined
        : this.readUuid(
            input.sessionSelectionToken,
            "sessionSelectionToken"
          );
    return { featureQuery, sessionId, sessionSelectionToken, sessionTitle };
  }

  private validateFocusInput(input: unknown): FocusSqlErdTablesInput {
    if (!this.isPlainObject(input)) {
      throw badRequest("focus_sql_erd_tables input must be an object");
    }
    this.assertAllowedFields(
      input,
      [
        "sessionId",
        "sessionRevision",
        "modelFingerprint",
        "featureLabel",
        "primaryTableRefs",
        "relatedTableRefs",
        "contextTableRefs",
        "confidence",
        "reasons"
      ],
      "focus_sql_erd_tables"
    );
    if (
      !Number.isSafeInteger(input.sessionRevision) ||
      Number(input.sessionRevision) < 1
    ) {
      throw badRequest("sessionRevision must be a positive integer");
    }
    const modelFingerprint = this.readBoundedText(
      input.modelFingerprint,
      32,
      "modelFingerprint"
    );
    if (!MODEL_FINGERPRINT_PATTERN.test(modelFingerprint)) {
      throw badRequest("modelFingerprint is invalid");
    }
    const primaryTableRefs = this.readTableRefs(
      input.primaryTableRefs,
      MAX_PRIMARY_TABLES,
      true,
      "primaryTableRefs"
    );
    const relatedTableRefs = this.readTableRefs(
      input.relatedTableRefs,
      MAX_RELATED_TABLES,
      false,
      "relatedTableRefs"
    );
    const contextTableRefs = this.readTableRefs(
      input.contextTableRefs,
      MAX_CONTEXT_TABLES,
      false,
      "contextTableRefs"
    );
    if (
      typeof input.confidence !== "string" ||
      !FOCUS_CONFIDENCE_VALUES.includes(
        input.confidence as (typeof FOCUS_CONFIDENCE_VALUES)[number]
      )
    ) {
      throw badRequest("confidence is invalid");
    }
    if (!Array.isArray(input.reasons) || input.reasons.length === 0) {
      throw badRequest("reasons must be a non-empty array");
    }
    if (input.reasons.length > MAX_FOCUS_REASONS) {
      throw badRequest("reasons exceeds the maximum item count");
    }
    const reasons = input.reasons.map((value) => {
      if (!this.isPlainObject(value)) {
        throw badRequest("focus reason must be an object");
      }
      this.assertAllowedFields(
        value,
        ["tableRef", "reason", "evidence"],
        "focus reason"
      );
      const tableRef = this.readTableRef(value.tableRef, "reason.tableRef");
      const evidence = this.validateContextEvidence(value.evidence);
      return {
        tableRef,
        reason: this.readBoundedText(value.reason, 240, "reason"),
        ...(evidence ? { evidence } : {})
      };
    });
    const selectedRefs = new Set([
      ...primaryTableRefs,
      ...relatedTableRefs,
      ...contextTableRefs
    ]);
    const reasonRefs = new Set(reasons.map((reason) => reason.tableRef));
    if (
      reasonRefs.size !== reasons.length ||
      reasonRefs.size !== selectedRefs.size ||
      [...reasonRefs].some((ref) => !selectedRefs.has(ref))
    ) {
      throw badRequest("reasons must contain each selected table reference once");
    }

    return {
      sessionId: this.readUuid(input.sessionId, "sessionId"),
      sessionRevision: Number(input.sessionRevision),
      modelFingerprint,
      featureLabel: this.readBoundedText(
        input.featureLabel,
        100,
        "featureLabel"
      ),
      primaryTableRefs,
      relatedTableRefs,
      contextTableRefs,
      confidence: input.confidence as FocusSqlErdTablesInput["confidence"],
      reasons
    };
  }

  private validateContextEvidence(
    value: unknown
  ): SqlErdAgentContextEvidence[] | undefined {
    if (value === undefined) return undefined;
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.length > MAX_CONTEXT_EVIDENCE_ITEMS
    ) {
      throw badRequest("focus evidence is invalid");
    }

    return value.map((item) => {
      if (!this.isPlainObject(item)) {
        throw badRequest("focus evidence must be an object");
      }
      this.assertAllowedFields(
        item,
        ["kind", "columnName", "value"],
        "focus evidence"
      );
      if (
        typeof item.kind !== "string" ||
        !CONTEXT_EVIDENCE_KINDS.includes(
          item.kind as (typeof CONTEXT_EVIDENCE_KINDS)[number]
        )
      ) {
        throw badRequest("focus evidence kind is invalid");
      }
      const kind = item.kind as SqlErdAgentContextEvidence["kind"];
      const requiresColumn = ![
        "table_name",
        "table_comment",
        "column_name"
      ].includes(kind);
      if (requiresColumn !== (item.columnName !== undefined)) {
        throw badRequest("focus evidence columnName is invalid");
      }
      return {
        kind,
        ...(requiresColumn
          ? {
              columnName: this.readBoundedText(
                item.columnName,
                80,
                "evidence.columnName"
              )
            }
          : {}),
        value: this.readBoundedExactText(
          item.value,
          240,
          "evidence.value"
        )
      };
    });
  }

  private readTableRefs(
    value: unknown,
    maxItems: number,
    requireOne: boolean,
    label: string
  ): string[] {
    if (
      !Array.isArray(value) ||
      (requireOne && value.length === 0) ||
      value.length > maxItems
    ) {
      throw badRequest(`${label} is invalid`);
    }
    const refs = value.map((ref) => this.readTableRef(ref, label));
    if (new Set(refs).size !== refs.length) {
      throw badRequest(`${label} must be unique`);
    }
    return refs;
  }

  private readTableRef(value: unknown, label: string): string {
    if (typeof value !== "string" || !TABLE_REF_PATTERN.test(value)) {
      throw badRequest(`${label} contains an invalid table reference`);
    }
    return value;
  }

  private readUuid(value: unknown, label: string): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw badRequest(`${label} must be a UUID`);
    }
    return value;
  }

  private readBoundedText(
    value: unknown,
    maxLength: number,
    label: string
  ): string {
    if (typeof value !== "string") {
      throw badRequest(`${label} must be a string`);
    }
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized || [...normalized].length > maxLength) {
      throw badRequest(`${label} length is invalid`);
    }
    return normalized;
  }

  private readBoundedExactText(
    value: unknown,
    maxLength: number,
    label: string
  ): string {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      [...value].length > maxLength
    ) {
      throw badRequest(`${label} length is invalid`);
    }
    return value;
  }

  private assertAllowedFields(
    value: Record<string, unknown>,
    allowedFields: string[],
    label: string
  ): void {
    const unexpected = Object.keys(value).find(
      (field) => !allowedFields.includes(field)
    );
    if (unexpected) {
      throw badRequest(`${label} field is invalid: ${unexpected}`);
    }
  }

  private async executeGenerate(
    context: AgentToolContext,
    input: unknown
  ): Promise<AgentToolExecutionResult> {
    if (this.isConfirmedInput(input)) {
      const confirmed = this.validateConfirmedInput(input);
      if (confirmed.targetMode === "replace_current") {
        const replacement = await this.sqlErdService.replaceAgentGeneratedSchema(
          context.currentUserId,
          context.workspaceId,
          confirmed.currentSessionId,
          context.runId,
          confirmed.schemaSpec,
          {
            revision: confirmed.expectedSessionRevision!,
            modelFingerprint: confirmed.expectedModelFingerprint!
          }
        );
        const session = await this.sqlErdService.getSession(
          context.currentUserId,
          context.workspaceId,
          confirmed.currentSessionId
        );
        return this.toExecutionResult(
          session,
          replacement.warnings,
          "replaced"
        );
      }

      const created = await this.sqlErdService.createAgentGeneratedSession(
        context.currentUserId,
        context.workspaceId,
        context.runId,
        confirmed.schemaSpec
      );
      return this.toExecutionResult(created.session, created.warnings, "created");
    }

    const schemaSpec = validateSqlErdSchemaSpec(input);
    const created = await this.sqlErdService.createAgentGeneratedSession(
      context.currentUserId,
      context.workspaceId,
      context.runId,
      schemaSpec
    );
    return this.toExecutionResult(created.session, created.warnings, "created");
  }

  private toExecutionResult(
    session: SqlErdSessionPayload,
    warnings: SqlErdSchemaGenerationWarning[],
    action: "created" | "replaced"
  ): AgentToolExecutionResult {
    const warningCodes = [...new Set(warnings.map((warning) => warning.code))];
    return {
      outputSummary: {
        action,
        title: session.title,
        dialect: session.dialect,
        tableCount: session.tableCount,
        relationCount: session.relationCount,
        warningCodes
      },
      resourceRefs: [
        {
          domain: "sqltoerd",
          resourceType: "session",
          resourceId: session.id,
          label: session.title,
          url: `/sql-erd/session?sessionId=${encodeURIComponent(session.id)}`,
          status: action,
          metadata: {
            dialect: session.dialect,
            tableCount: session.tableCount,
            relationCount: session.relationCount
          }
        }
      ],
      status: action
    };
  }

  private isConfirmedInput(input: unknown): boolean {
    return this.isPlainObject(input) && "targetMode" in input;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }

  private toAgentJsonObject(value: unknown): AgentJsonObject {
    return JSON.parse(JSON.stringify(value)) as AgentJsonObject;
  }
}
