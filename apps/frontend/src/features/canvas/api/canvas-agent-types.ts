export type CanvasAgentViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasAgentProgress = {
  message: string;
  highlightedShapeIds: string[];
  targetViewport: CanvasAgentViewport | null;
  toolTarget: string | null;
  toolTargetLabel: string | null;
};

export type CanvasAgentRun = {
  id: string;
  workspaceId: string;
  canvasId: string;
  status:
    | "queued"
    | "planning"
    | "executing"
    | "draft_ready"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
  prompt: string;
  message: string | null;
  summary: string | null;
  canvasRevision: number | null;
  progress: CanvasAgentProgress | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
};

export type CanvasAgentDraftNode = {
  id: string;
  kind: "frame" | "note" | "code";
  title: string;
  text: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  code?: string;
  language?: string;
};

export type CanvasAgentDraftSpec = {
  kind: "diagram" | "organize" | "code";
  title: string;
  summary: string;
  sourceShapeIds: string[];
  sourceRevisions: Record<string, number>;
  nodes: CanvasAgentDraftNode[];
  connections: Array<{ from: string; to: string }>;
};

export type CanvasAgentDraft = {
  id: string;
  status: "preview" | "applied" | "discarded" | "expired";
  summary: string;
  spec: CanvasAgentDraftSpec;
  appliedShapeIds: string[];
  appliedAt: string | null;
  expiresAt: string;
};

export type CanvasAgentIntentExample = {
  id: string;
  intent:
    | "find_canvas_tool"
    | "find_shapes"
    | "select_shapes"
    | "focus_viewport"
    | "create_draft"
    | "create_code_block"
    | "finish";
  status: "pending" | "active" | "rejected" | "expired";
  embeddingStatus: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  reviewedAt: string | null;
  expiresAt: string;
};

export type CanvasAgentRunDetail = {
  run: CanvasAgentRun;
  steps: Array<{
    id: string;
    order: number;
    actionName: string;
    status: string;
    resourceRefs: string[];
    completedAt: string | null;
  }>;
  drafts: CanvasAgentDraft[];
  intentExamples: CanvasAgentIntentExample[];
  canRememberIntent: boolean;
};
