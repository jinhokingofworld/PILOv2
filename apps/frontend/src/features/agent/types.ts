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
      canvasContext: {
        presentationMode: "interactive" | "background";
        selectedShapeIds?: string[];
        shapeSummaries?: unknown[];
        selectedScene?: Record<string, unknown> | null;
        selectedSceneError?: string | null;
        toolHelpMode?: boolean;
        viewport?: {
          x: number;
          y: number;
          width: number;
          height: number;
        } | null;
      };
    }
  | null;

export type AgentResourceRef = {
  contextRef?: string | null;
  domain?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
  resourceId?: string | null;
  resourceType?: string | null;
  status?: string | null;
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

export type AgentApprovalConfirmationPlan = {
  kind?: "approval";
  toolName: string;
  summary: string;
  target: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  call: Record<string, unknown>;
};

export type AgentChoiceConfirmationPlan = {
  kind: "choice";
  toolName: string;
  summary: string;
  target: Record<string, unknown>;
  call: Record<string, unknown>;
  choices: Array<{
    id: string;
    label: string;
    description?: string;
    input: Record<string, unknown>;
  }>;
};

export type AgentConfirmationPlan =
  | AgentApprovalConfirmationPlan
  | AgentChoiceConfirmationPlan;

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
  selectedChoiceId: string | null;
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
  requestContext: AgentRunRequestContext;
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
  requestContext?: AgentRunRequestContext;
};

export type AgentConfirmationApproveInput = {
  choiceId: string;
};

export type AgentRunInputSelection = {
  kind: "candidate";
  candidateSelectionId: string;
} | {
  kind: "meeting_candidate";
  candidateSelectionId: string;
};

export type SubmitAgentRunInput = {
  message: string;
  selection?: AgentRunInputSelection;
};

export type AgentRunDetailPayload = {
  run: AgentRun;
};

export type AgentContextNavigationPayload = {
  kind: "meeting_report" | "drive_document" | "sql_erd_session";
  href: string;
  focus?: {
    version: 1;
    view: "table_focus";
    sessionId: string;
    sessionRevision: number;
    modelFingerprint: string;
    featureLabel: string;
    primaryTableIds: string[];
    relatedTableIds: string[];
    contextTableIds: string[];
    relationIds: string[];
    confidence: "high" | "medium" | "low";
  };
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
      selectedChoiceId: string | null;
    };
  };
};
