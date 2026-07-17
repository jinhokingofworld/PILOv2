import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import {
  DocumentSearchService,
  type DocumentSearchInput
} from "../../drive/document-search.service";
import type {
  AgentJsonObject,
  AgentResourceRef,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolExecutionResult
} from "../types/agent-tool.types";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 8;
const MAX_QUERY_LENGTH = 1_000;
const FORBIDDEN_INPUT_FIELDS = [
  "workspaceId",
  "documentId",
  "userId",
  "currentUserId",
  "requestedByUserId"
];
const SEARCH_INPUT_FIELDS = ["query", "topK"];

@Injectable()
export class DriveAgentToolsService {
  constructor(private readonly documentSearchService: DocumentSearchService) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [this.searchWorkspaceDocumentsDefinition()];
  }

  private searchWorkspaceDocumentsDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "search_workspace_documents",
      description:
        "Workspace\uc5d0\uc11c \ucd5c\uc2e0 \uc0c1\ud0dc\ub85c \uc778\ub371\uc2f1\ub41c \ubb38\uc11c\ub97c \uc758\ubbf8 \uae30\ubc18\uc73c\ub85c \uac80\uc0c9\ud569\ub2c8\ub2e4. \ubb38\uc11c \uc81c\ubaa9\uc5d0 \uc5c6\ub294 \ub0b4\uc6a9\uc73c\ub85c\ub3c4 \uac80\uc0c9\ud558\uba70, \ubb38\uc11c\ub97c \uc218\uc815\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: MAX_QUERY_LENGTH },
          topK: { type: "integer", minimum: 1, maximum: MAX_TOP_K }
        }
      },
      validateInput: (input) => this.validateSearchInput(input),
      execute: (context, input) =>
        this.executeSearchWorkspaceDocuments(
          context,
          this.validateSearchInput(input)
        )
    };
  }

  private async executeSearchWorkspaceDocuments(
    context: AgentToolContext,
    input: DocumentSearchInput
  ): Promise<AgentToolExecutionResult> {
    const results = await this.documentSearchService.search(
      context.currentUserId,
      context.workspaceId,
      input
    );

    return {
      outputSummary: {
        count: results.length,
        documents: results.map((result) => ({
          title: result.title,
          headingPath: result.headingPath,
          excerpt: result.excerpt
        }))
      },
      resourceRefs: results.map((result) => this.toResourceRef(result)),
      status: "completed"
    };
  }

  private validateSearchInput(input: unknown): DocumentSearchInput {
    const draft = this.requirePlainObject(input);
    this.rejectForbiddenFields(draft);
    this.assertOnlyAllowedFields(draft);

    return {
      query: this.readRequiredQuery(draft),
      topK: this.readTopK(draft.topK)
    };
  }

  private toResourceRef(result: {
    documentId: string;
    title: string;
    headingPath: string;
  }): AgentResourceRef {
    return {
      domain: "drive",
      resourceType: "document",
      resourceId: result.documentId,
      label: result.title,
      url: `/files?documentId=${encodeURIComponent(result.documentId)}`,
      metadata: { headingPath: result.headingPath }
    };
  }

  private requirePlainObject(input: unknown): AgentJsonObject {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input)
    ) {
      throw badRequest("Document search input must be an object");
    }

    return input as AgentJsonObject;
  }

  private rejectForbiddenFields(input: AgentJsonObject): void {
    for (const field of FORBIDDEN_INPUT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        throw badRequest(`${field} must not be provided to Drive tools`);
      }
    }
  }

  private assertOnlyAllowedFields(input: AgentJsonObject): void {
    const allowedFields = new Set(SEARCH_INPUT_FIELDS);
    for (const field of Object.keys(input)) {
      if (!allowedFields.has(field)) {
        throw badRequest(`Document search input.${field} is not supported`);
      }
    }
  }

  private readRequiredQuery(input: AgentJsonObject): string {
    const value = input.query;
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest("query must be a non-empty string");
    }

    const query = value.trim();
    if (query.length > MAX_QUERY_LENGTH) {
      throw badRequest(`query must be ${MAX_QUERY_LENGTH} characters or less`);
    }

    return query;
  }

  private readTopK(value: unknown): number {
    if (value === undefined) return DEFAULT_TOP_K;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_TOP_K
    ) {
      throw badRequest(`topK must be an integer between 1 and ${MAX_TOP_K}`);
    }

    return value;
  }
}
