export type AgentRiskLevel = "low" | "medium" | "high";

export type AgentJsonPrimitive = string | number | boolean | null;

export type AgentJsonValue =
  | AgentJsonPrimitive
  | AgentJsonObject
  | AgentJsonValue[];

export interface AgentJsonObject {
  [key: string]: AgentJsonValue;
}

export type AgentSurface = "sql_erd" | "pr_review" | "canvas";

export type AgentToolExecutionMode =
  | "auto"
  | "confirmation_required"
  | "contextual";

export type AgentRunRequestContext =
  | {
      surface: "sql_erd";
      sessionId: string;
    }
  | {
      surface: "pr_review";
      sessionId: string;
    }
  | {
      surface: "canvas";
      canvasId: string;
      canvasContext: AgentJsonObject;
    }
  | null;

export type AgentPlannerRequestContext =
  | Exclude<AgentRunRequestContext, { surface: "canvas" }>
  | {
      surface: "canvas";
      canvasId: string;
    };

export type AgentToolInputSchema = AgentJsonObject;

export type AgentToolInputSummary = AgentJsonObject;

export type AgentToolOutputSummary = AgentJsonObject;

export interface AgentToolContextRequirement {
  surface: AgentSurface;
}

export interface AgentToolContext {
  currentUserId: string;
  workspaceId: string;
  runId: string;
  requestContext: AgentRunRequestContext;
}

export interface AgentResourceRef {
  domain: string;
  resourceType: string;
  resourceId: string;
  label?: string;
  url?: string;
  status?: string;
  metadata?: AgentJsonObject;
}

export interface AgentApprovalConfirmationPlan {
  kind?: "approval";
  toolName: string;
  summary: string;
  target: AgentJsonObject;
  before: AgentJsonObject | null;
  after: AgentJsonObject;
  call: AgentJsonObject;
}

export interface AgentChoiceConfirmationOption {
  id: string;
  label: string;
  description?: string;
  input: AgentJsonObject;
}

export interface AgentChoiceConfirmationPlan {
  kind: "choice";
  toolName: string;
  summary: string;
  target: AgentJsonObject;
  call: AgentJsonObject;
  choices: AgentChoiceConfirmationOption[];
}

export type AgentConfirmationPlan =
  | AgentApprovalConfirmationPlan
  | AgentChoiceConfirmationPlan;

export interface AgentToolClarificationResult {
  kind: "needs_clarification";
  outputSummary: AgentToolOutputSummary;
  resourceRefs: AgentResourceRef[];
  /** Server-only references. AgentExecution persists opaque candidate IDs before output is stored. */
  candidateResources?: Array<{
    reference: {
      /** Omitted only by the legacy Meeting adapter. New adapters must provide a domain. */
      domain?: string;
      resourceType: string;
      resourceId: string;
      reportId?: string;
    };
    candidate: {
      resourceType?: string;
      label: string;
      description: string | null;
      status: string | null;
    };
  }>;
}

export type AgentToolPreparationResult =
  | {
      kind: "execute";
    }
  | {
      kind: "confirmation";
      plan: AgentConfirmationPlan;
    }
  | AgentToolClarificationResult;

export interface AgentToolExecutionResult {
  outputSummary: AgentToolOutputSummary;
  resourceRefs: AgentResourceRef[];
  status?: string;
  /** Server-only evidence. It must never be copied into the public output summary. */
  groundingSources?: AgentGroundingSourceCandidate[];
}

export interface AgentGroundingSourceCandidate {
  sourceType: "meeting_transcript" | "meeting_activity" | "drive_document";
  sourceRef: string;
  title?: string;
  excerpt: string;
  score: number;
  resourceRef: AgentResourceRef;
}

export type AgentToolPostExecutionDisposition =
  | "continue_planning"
  | "wait_for_user_input"
  | "complete_run";

export interface AgentToolDefinition<TInput> {
  name: string;
  description: string;
  riskLevel: AgentRiskLevel;
  executionMode: AgentToolExecutionMode;
  contextRequirement?: AgentToolContextRequirement;
  requiresGroundedAnswer?: boolean;
  postExecutionDisposition?: AgentToolPostExecutionDisposition;
  inputSchema: AgentToolInputSchema;
  validateInput: (input: unknown) => TInput;
  /**
   * Server-only compatibility adapter for planner steps persisted under an
   * earlier tool schema. Its result is never a planner-facing schema.
   */
  adaptLegacyPlannerInput?: (input: unknown) => TInput | null;
  buildConfirmation?: (
    context: AgentToolContext,
    input: TInput
  ) =>
    | AgentConfirmationPlan
    | AgentToolClarificationResult
    | Promise<AgentConfirmationPlan | AgentToolClarificationResult>;
  prepareExecution?: (
    context: AgentToolContext,
    input: TInput
  ) => AgentToolPreparationResult | Promise<AgentToolPreparationResult>;
  buildConfirmationInput?: (
    plan: AgentConfirmationPlan,
    selectedChoiceId?: string | null
  ) => unknown;
  validateConfirmationInput?: (input: unknown) => unknown;
  execute: (
    context: AgentToolContext,
    input: TInput
  ) => Promise<AgentToolExecutionResult>;
}
