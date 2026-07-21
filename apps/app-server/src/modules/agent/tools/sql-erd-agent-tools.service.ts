import { HttpException, Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
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
import {
  buildSqlErdAgentSchemaProjection,
  createSqlErdModelFingerprint,
  resolveSqlErdAgentTableFocus
} from "./sql-erd-table-focus";
import {
  resolveDeterministicSqlErdTableFocus,
  type SqlErdFocusResolution,
  validateLlmSqlErdTableFocus
} from "./sql-erd-table-focus-resolver";

type SqlErdAgentTargetMode = "new_session" | "replace_current";

interface ConfirmedSqlErdAgentInput {
  currentSessionId: string;
  schemaSpec: SqlErdSchemaSpecV1;
  targetMode: SqlErdAgentTargetMode;
  expectedSessionRevision?: number;
  expectedModelFingerprint?: string;
}

interface FocusSqlErdTablesRequest {
  featureQuery: string;
}

interface FocusSqlErdReason {
  tableRef: string;
  reason: string;
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

const TARGET_MODES: SqlErdAgentTargetMode[] = [
  "new_session",
  "replace_current"
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_FINGERPRINT_PATTERN = /^fnv1a32:[0-9a-f]{8}$/;
const FOCUS_SQL_ERD_INPUT_SCHEMA: AgentToolInputSchema = {
  type: "object",
  required: ["featureQuery"],
  additionalProperties: false,
  properties: {
    featureQuery: { type: "string", minLength: 1, maxLength: 200 }
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
      this.focusSqlErdTablesDefinition()
    ];
  }

  private focusSqlErdTablesDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "focus_sql_erd_tables",
      description:
        "현재 SQLtoERD 화면의 schema를 서버가 안전하게 검사해 요청 기능의 핵심 테이블과 직접 FK 연결 테이블을 집중 보기로 만듭니다. featureQuery만 전달하며 session ID나 table ref를 추측하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      contextRequirement: { surface: "sql_erd" },
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

  private async executeFocus(
    context: AgentToolContext,
    input: FocusSqlErdTablesRequest
  ): Promise<AgentToolExecutionResult> {
    if (
      context.requestContext?.surface !== "sql_erd" ||
      !context.requestContext.sessionId
    ) {
      throw badRequest("focus_sql_erd_tables requires SQLtoERD session context");
    }
    const inspectedSession = await this.readFocusSession(
      context.currentUserId,
      context.workspaceId,
      context.requestContext.sessionId
    );
    if (!inspectedSession) {
      return this.focusClarification(
        "session_unavailable",
        "현재 ERD를 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 요청해주세요."
      );
    }
    const inspectedFingerprint = createSqlErdModelFingerprint(
      inspectedSession.modelJson
    );
    const projection = buildSqlErdAgentSchemaProjection(
      inspectedSession.modelJson,
      input.featureQuery,
      inspectedSession.sourceText
    );
    const inspectedEvidenceFingerprint = createSqlErdModelFingerprint(projection);
    const resolution =
      resolveDeterministicSqlErdTableFocus(projection, input.featureQuery) ??
      (await this.resolveSqlErdTableFocusWithLlm(projection, input.featureQuery));
    if (resolution.kind === "needs_clarification") {
      return {
        outputSummary: this.toAgentJsonObject({
          action: "needs_clarification",
          status: "needs_clarification",
          reason: resolution.reason,
          question: resolution.question
        }),
        resourceRefs: [],
        status: "needs_clarification"
      };
    }

    const session = await this.readFocusSession(
      context.currentUserId,
      context.workspaceId,
      inspectedSession.id
    );
    if (!session) {
      return this.focusClarification(
        "session_unavailable",
        "현재 ERD를 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 요청해주세요."
      );
    }
    const modelFingerprint = createSqlErdModelFingerprint(session.modelJson);
    const currentProjection = buildSqlErdAgentSchemaProjection(
      session.modelJson,
      input.featureQuery,
      session.sourceText
    );
    const evidenceFingerprint = createSqlErdModelFingerprint(currentProjection);
    if (
      modelFingerprint !== inspectedFingerprint ||
      evidenceFingerprint !== inspectedEvidenceFingerprint
    ) {
      return this.focusClarification(
        "schema_changed",
        "ERD가 변경되었습니다. 최신 상태에서 집중 보기를 다시 요청해주세요."
      );
    }
    const resolvedInput = this.toResolvedFocusInput(
      session.id,
      session.revision,
      modelFingerprint,
      resolution
    );
    const reasonByRef = new Map(
      resolvedInput.reasons.map((item) => [item.tableRef, item.reason])
    );
    const resolved = resolveSqlErdAgentTableFocus(
      session.modelJson,
      resolvedInput
    );
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
        sessionRevision: session.revision,
        modelFingerprint,
        title: session.title,
        featureLabel: resolvedInput.featureLabel,
        confidence: resolvedInput.confidence,
        primaryTables,
        relatedTables,
        contextTables,
        ignoredContextTables: [],
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
            featureLabel: resolvedInput.featureLabel,
            primaryTableIds: resolved.primaryTableIds,
            relatedTableIds: resolved.relatedTableIds,
            contextTableIds: resolved.contextTableIds,
            relationIds: resolved.relationIds,
            confidence: resolvedInput.confidence
          }
        }
      ],
      status: "focused"
    };
  }

  private validateFocusInput(input: unknown): FocusSqlErdTablesRequest {
    if (!this.isPlainObject(input)) {
      throw badRequest("focus_sql_erd_tables input must be an object");
    }
    this.assertAllowedFields(
      input,
      ["featureQuery"],
      "focus_sql_erd_tables"
    );
    return {
      featureQuery: this.readBoundedText(input.featureQuery, 200, "featureQuery")
    };
  }

  private toResolvedFocusInput(
    sessionId: string,
    sessionRevision: number,
    modelFingerprint: string,
    resolution: Extract<SqlErdFocusResolution, { kind: "focused" }>
  ): FocusSqlErdTablesInput {
    return {
      sessionId,
      sessionRevision,
      modelFingerprint,
      featureLabel: resolution.featureLabel,
      primaryTableRefs: resolution.primaryTableRefs,
      relatedTableRefs: resolution.relatedTableRefs,
      contextTableRefs: [],
      confidence: resolution.confidence,
      reasons: [
        ...resolution.primaryTableRefs.map((tableRef) => ({
          tableRef,
          reason: "요청 기능의 핵심 schema evidence와 일치합니다."
        })),
        ...resolution.relatedTableRefs.map((tableRef) => ({
          tableRef,
          reason: "핵심 테이블과 직접 FK로 연결됩니다."
        }))
      ]
    };
  }

  private async resolveSqlErdTableFocusWithLlm(
    projection: ReturnType<typeof buildSqlErdAgentSchemaProjection>,
    featureQuery: string
  ): Promise<SqlErdFocusResolution> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return {
        kind: "needs_clarification",
        reason: "resolver_unavailable",
        question:
          "테이블 이름만으로 대상을 확정하지 못했습니다. 집중할 테이블 이름을 알려주세요."
      };
    }

    const controller = new AbortController();
    const configuredTimeout = Number(
      process.env.OPENAI_SQL_ERD_FOCUS_TIMEOUT_MS
    );
    const timeout = setTimeout(
      () => controller.abort(),
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 8_000
    );
    try {
      const response = await fetch(
        process.env.OPENAI_RESPONSES_API_URL ??
          "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model:
              process.env.OPENAI_SQL_ERD_FOCUS_MODEL ?? "gpt-5.1-mini",
            input: [
              {
                role: "system",
                content:
                  "Select only the primary SQLtoERD table refs that directly implement the requested feature. Respect exclusion and negation in the feature query. Refs listed in truncatedTableRefs have prefix-only names, so do not treat those names as exact identity; request clarification unless independent schema evidence resolves them. Do not add FK neighbors; the server expands them. If the schema evidence is insufficient or ambiguous, request clarification. Return only the requested JSON schema."
              },
              {
                role: "user",
                content: JSON.stringify({ featureQuery, projection })
              }
            ],
            text: {
              format: {
                type: "json_schema",
                name: "sql_erd_table_focus_resolution",
                strict: true,
                schema: {
                  type: "object",
                  required: [
                    "status",
                    "featureLabel",
                    "primaryTableRefs",
                    "confidence",
                    "question"
                  ],
                  additionalProperties: false,
                  properties: {
                    status: {
                      type: "string",
                      enum: ["focused", "needs_clarification"]
                    },
                    featureLabel: { type: ["string", "null"], maxLength: 100 },
                    primaryTableRefs: {
                      type: "array",
                      maxItems: 20,
                      uniqueItems: true,
                      items: { type: "string", pattern: "^t[1-9][0-9]*$" }
                    },
                    confidence: {
                      type: "string",
                      enum: ["high", "medium", "low"]
                    },
                    question: { type: ["string", "null"], maxLength: 240 }
                  }
                }
              }
            }
          }),
          signal: controller.signal
        }
      );
      if (!response.ok) {
        return this.focusResolverUnavailable();
      }
      const body = await response.json();
      const outputText = this.extractOpenAiOutputText(body);
      return outputText
        ? validateLlmSqlErdTableFocus(
            projection,
            featureQuery,
            JSON.parse(outputText)
          )
        : this.focusResolverUnavailable();
    } catch {
      return this.focusResolverUnavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  private focusResolverUnavailable(): SqlErdFocusResolution {
    return {
      kind: "needs_clarification",
      reason: "resolver_unavailable",
      question:
        "관련 테이블을 안전하게 확정하지 못했습니다. 집중할 테이블 이름을 알려주세요."
    };
  }

  private async readFocusSession(
    currentUserId: string,
    workspaceId: string,
    sessionId: string
  ): Promise<SqlErdSessionPayload | null> {
    try {
      return await this.sqlErdService.getSession(
        currentUserId,
        workspaceId,
        sessionId
      );
    } catch (error) {
      if (
        error instanceof HttpException &&
        (error.getStatus() === 403 || error.getStatus() === 404)
      ) {
        return null;
      }
      throw error;
    }
  }

  private focusClarification(
    reason: "schema_changed" | "session_unavailable",
    question: string
  ): AgentToolExecutionResult {
    return {
      outputSummary: this.toAgentJsonObject({
        action: "needs_clarification",
        status: "needs_clarification",
        reason,
        question
      }),
      resourceRefs: [],
      status: "needs_clarification"
    };
  }

  private extractOpenAiOutputText(value: unknown): string | null {
    if (!this.isPlainObject(value)) return null;
    if (typeof value.output_text === "string") return value.output_text;
    if (!Array.isArray(value.output)) return null;
    for (const output of value.output) {
      if (!this.isPlainObject(output) || !Array.isArray(output.content)) {
        continue;
      }
      for (const content of output.content) {
        if (
          this.isPlainObject(content) &&
          content.type === "output_text" &&
          typeof content.text === "string"
        ) {
          return content.text;
        }
      }
    }
    return null;
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
