export type AgentRiskLevel = "low" | "medium" | "high";

export type AgentToolExecutionMode = "auto" | "confirmation_required";

export type AgentJsonPrimitive = string | number | boolean | null;

export type AgentJsonValue =
  | AgentJsonPrimitive
  | AgentJsonObject
  | AgentJsonValue[];

export interface AgentJsonObject {
  [key: string]: AgentJsonValue;
}

export type AgentToolInputSchema = AgentJsonObject;

export type AgentToolInputSummary = AgentJsonObject;

export type AgentToolOutputSummary = AgentJsonObject;

export interface AgentToolContext {
  currentUserId: string;
  workspaceId: string;
  runId: string;
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

export interface AgentConfirmationPlan {
  toolName: string;
  summary: string;
  target: AgentJsonObject;
  before: AgentJsonObject | null;
  after: AgentJsonObject;
  call: AgentJsonObject;
}

export interface AgentToolClarificationResult {
  kind: "needs_clarification";
  outputSummary: AgentToolOutputSummary;
  resourceRefs: AgentResourceRef[];
}

export interface AgentToolExecutionResult {
  outputSummary: AgentToolOutputSummary;
  resourceRefs: AgentResourceRef[];
  status?: string;
}

export interface AgentToolDefinition<TInput> {
  name: string;
  description: string;
  riskLevel: AgentRiskLevel;
  executionMode: AgentToolExecutionMode;
  requiresGroundedAnswer?: boolean;
  inputSchema: AgentToolInputSchema;
  validateInput: (input: unknown) => TInput;
  buildConfirmation?: (
    context: AgentToolContext,
    input: TInput
  ) =>
    | AgentConfirmationPlan
    | AgentToolClarificationResult
    | Promise<AgentConfirmationPlan | AgentToolClarificationResult>;
  buildConfirmationInput?: (plan: AgentConfirmationPlan) => unknown;
  validateConfirmationInput?: (input: unknown) => unknown;
  execute: (
    context: AgentToolContext,
    input: TInput
  ) => Promise<AgentToolExecutionResult>;
}
