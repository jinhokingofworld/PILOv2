export type AgentRunStatus =
  | "planning"
  | "waiting_user_input"
  | "waiting_confirmation"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type AgentConfirmationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export type AgentRiskLevel = "low" | "medium" | "high";

export type AgentResourceRef = {
  id?: string | number | null;
  type?: string | null;
  label?: string | null;
  url?: string | null;
  [key: string]: unknown;
};

export type AgentStep = {
  id: string;
  runId: string;
  order: number;
  type: "planner" | "tool" | "answer";
  status: AgentStepStatus;
  toolName: string | null;
  riskLevel: AgentRiskLevel | null;
  inputSummary: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
  resourceRefs: AgentResourceRef[];
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type AgentConfirmationPlan = {
  toolName: string;
  summary: string;
  target: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  call: Record<string, unknown>;
};

export type AgentConfirmation = {
  id: string;
  runId: string;
  status: AgentConfirmationStatus;
  riskLevel: AgentRiskLevel;
  plan?: AgentConfirmationPlan | null;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunMessage = {
  id: string;
  sequence: number;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  workspaceId: string;
  requestedByUserId: string;
  clientRequestId: string | null;
  status: AgentRunStatus;
  riskLevel: AgentRiskLevel | null;
  prompt: string;
  timezone: string;
  message: string | null;
  finalAnswer: string | null;
  errorMessage: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  messages: AgentRunMessage[];
  steps: AgentStep[];
  confirmation: AgentConfirmation | null;
};

export type CreateAgentRunInput = {
  prompt: string;
  timezone?: string;
  clientRequestId?: string;
};

export type SubmitAgentRunInput = {
  message: string;
};

export type AgentRunDetailPayload = {
  run: AgentRun;
};

export type AgentConfirmationActionPayload = {
  run: {
    id: string;
    status: AgentRunStatus;
    message: string | null;
    confirmation: {
      id: string;
      status: AgentConfirmationStatus;
      approvedAt: string | null;
      rejectedAt: string | null;
    };
  };
};
