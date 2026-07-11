export type CanvasAgentViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasAgentPresentationMode = "interactive" | "background";

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
  presentationMode: CanvasAgentPresentationMode;
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
  kind: "frame" | "note" | "text" | "rectangle" | "circle" | "triangle" | "code";
  title: string;
  text: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  code?: string;
  language?: string;
  parentId?: string | null;
};

export type CanvasAgentDraftColorOption = {
  name: string;
  label: string;
  hex: string;
  bestFor: string;
};

export type CanvasAgentDraftRecommendedColor = {
  name: string;
  label: string;
  usage: string;
};

export type CanvasAgentDraftSpec = {
  kind: "diagram" | "code";
  title: string;
  summary: string;
  sourceShapeIds: string[];
  sourceRevisions: Record<string, number>;
  availableColors: CanvasAgentDraftColorOption[];
  recommendedColors: CanvasAgentDraftRecommendedColor[];
  nodes: CanvasAgentDraftNode[];
  connections: Array<{
    id?: string;
    from: string;
    to: string;
    kind?: "arrow" | "line";
    text?: string | null;
    color?: string;
  }>;
  toolSteps?: Array<{
    kind: "tool" | "place" | "connect";
    toolTarget?: string;
    toolTargetLabel?: string;
    nodeId?: string;
    connectionId?: string;
    from?: string;
    to?: string;
    x?: number;
    y?: number;
  }>;
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

export type CanvasAgentDraftApplyResult = {
  draft: CanvasAgentDraft;
  latestOpSeq: number;
  batch: unknown;
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
};
