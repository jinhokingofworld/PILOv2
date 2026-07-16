import { Injectable } from "@nestjs/common";
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

type SqlErdAgentTargetMode = "new_session" | "replace_current";

interface ConfirmedSqlErdAgentInput {
  currentSessionId: string;
  schemaSpec: SqlErdSchemaSpecV1;
  targetMode: SqlErdAgentTargetMode;
}

const TARGET_MODES: SqlErdAgentTargetMode[] = [
  "new_session",
  "replace_current"
];

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
    return [this.generateSqlErdDefinition()];
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

    return {
      kind: "confirmation" as const,
      plan: {
        kind: "choice" as const,
        toolName: "generate_sql_erd",
        summary: "생성한 스키마를 어디에 적용할지 선택해주세요.",
        target: {
          domain: "sqltoerd",
          resourceType: "session",
          resourceId: session.id
        },
        call: {
          schemaSpec: this.toAgentJsonObject(schemaSpec),
          currentSessionId: session.id
        },
        choices: [
          {
            id: "new_session",
            label: "새 세션 만들기",
            description: "현재 세션을 유지하고 생성 결과를 새 세션에 저장합니다.",
            input: { targetMode: "new_session" }
          },
          {
            id: "replace_current",
            label: "현재 스키마 교체",
            description:
              "현재 세션의 제목과 레이아웃 호환 요소는 유지하고 스키마를 교체합니다.",
            input: { targetMode: "replace_current" }
          }
        ]
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
    const allowedFields = ["schemaSpec", "currentSessionId", "targetMode"];
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

    return {
      currentSessionId: input.currentSessionId,
      schemaSpec: validateSqlErdSchemaSpec(input.schemaSpec),
      targetMode: input.targetMode as SqlErdAgentTargetMode
    };
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
          confirmed.schemaSpec
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
