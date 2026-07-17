import { QueryResultRow } from "pg";
import type { CanvasShapeBatchPayload } from "../contracts/canvas.types";

export const CANVAS_AGENT_ACTION_NAMES = [
  "route_intent",
  "find_canvas_tool",
  "find_shapes",
  "select_shapes",
  "focus_viewport",
  "connect_shapes",
  "create_draft",
  "finish"
] as const;

export const CANVAS_AGENT_INTENT_NAMES = ["find_shapes", "generate_html", "unsupported"] as const;
export type CanvasAgentIntentName = (typeof CANVAS_AGENT_INTENT_NAMES)[number];

export type CanvasAgentActionName = (typeof CANVAS_AGENT_ACTION_NAMES)[number];
export type CanvasAgentRunStatus =
  | "queued"
  | "planning"
  | "executing"
  | "draft_ready"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";
export type CanvasAgentStepStatus =
  | "pending"
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "skipped";
export type CanvasAgentDraftStatus =
  | "preview"
  | "applied"
  | "discarded"
  | "expired";
export type CanvasAgentPresentationMode = "interactive" | "background";

export interface CanvasAgentRunRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  canvas_id: string;
  requested_by_user_id: string;
  parent_agent_run_id: string | null;
  source: string;
  status: CanvasAgentRunStatus;
  prompt: string;
  context_json: Record<string, unknown>;
  canvas_revision: number | string | null;
  result_summary: string | null;
  result_json: Record<string, unknown>;
  client_request_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  expires_at: Date | string;
}

export interface CanvasAgentStepRow extends QueryResultRow {
  id: string;
  run_id: string;
  step_order: number | string;
  action_name: CanvasAgentActionName;
  status: CanvasAgentStepStatus;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  resource_refs: unknown[];
  model_name: string | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
}

export interface CanvasAgentDraftRow extends QueryResultRow {
  id: string;
  run_id: string;
  canvas_id: string;
  created_by_user_id: string;
  status: CanvasAgentDraftStatus;
  draft_spec_json: CanvasDraftSpec;
  applied_shape_ids: unknown[];
  created_at: Date | string;
  applied_at: Date | string | null;
  expires_at: Date | string;
}

export interface CanvasAgentShapeRow extends QueryResultRow {
  id: string;
  title: string | null;
  text_content: string | null;
  shape_type: string;
  x: number | string;
  y: number | string;
  width: number | string | null;
  height: number | string | null;
  revision: number | string;
  raw_shape: Record<string, unknown>;
}

export interface CanvasAgentViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasAgentConversationMessage {
  role: "assistant" | "user";
  content: string;
}

export interface CanvasAgentLastTaskContext {
  draftId: string | null;
  draftTitle: string | null;
  prompt: string;
  status: string;
  summary: string | null;
}

export interface CanvasAgentConversationContext {
  messages: CanvasAgentConversationMessage[];
  lastTask: CanvasAgentLastTaskContext | null;
}

export interface CanvasAgentShapeSummary {
  id: string;
  shapeType: string;
  title: string | null;
  text: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasAgentSelectedSceneShape {
  id: string;
  shapeType: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  depth: number;
  title: string | null;
  text: string | null;
  assetRef: string | null;
  style: Record<string, string | number | boolean | null>;
}

export interface CanvasAgentSelectedScene {
  selectionMode: "frame" | "multi-selection";
  bounds: { width: number; height: number };
  rootShapeIds: string[];
  shapes: CanvasAgentSelectedSceneShape[];
  options: {
    styleMode: "faithful";
    responsive: false;
    includeJavaScript: false;
  };
}

export interface CanvasAgentHtmlArtifact {
  kind: "html";
  title: string;
  html: string;
  sourceShapeIds: string[];
}

export interface CreateCanvasAgentRunRequest {
  prompt?: unknown;
  selectedShapeIds?: unknown;
  shapeSummaries?: unknown;
  selectedScene?: unknown;
  selectedSceneError?: unknown;
  presentationMode?: unknown;
  toolHelpMode?: unknown;
  viewport?: unknown;
  clientRequestId?: unknown;
  conversationContext?: unknown;
}

export interface ApplyCanvasAgentDraftRequest {
  clientOperationId?: unknown;
}

export interface CanvasAgentRequestContext {
  conversationContext: CanvasAgentConversationContext | null;
  presentationMode: CanvasAgentPresentationMode;
  selectedShapeIds: string[];
  shapeSummaries: CanvasAgentShapeSummary[];
  selectedScene: CanvasAgentSelectedScene | null;
  selectedSceneError: string | null;
  toolHelpMode: boolean;
  viewport: CanvasAgentViewport | null;
}

export interface CanvasAgentProgressPayload {
  message: string;
  highlightedShapeIds: string[];
  targetViewport: CanvasAgentViewport | null;
  toolTarget: string | null;
  toolTargetLabel: string | null;
}

export type CanvasAgentDraftNodeKind =
  | "frame"
  | "note"
  | "text"
  | "rectangle"
  | "circle"
  | "triangle"
  | "code";

export interface CanvasAgentDraftNode {
  id: string;
  kind: CanvasAgentDraftNodeKind;
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
}

export interface CanvasAgentDraftConnection {
  id?: string;
  from: string;
  to: string;
  kind?: "arrow" | "line";
  text?: string | null;
  color?: string;
}

export interface CanvasAgentDraftToolStep {
  kind: "tool" | "place" | "connect";
  toolTarget?: string;
  toolTargetLabel?: string;
  nodeId?: string;
  connectionId?: string;
  from?: string;
  to?: string;
  x?: number;
  y?: number;
}

export interface CanvasAgentDraftColorOption {
  name: string;
  label: string;
  hex: string;
  bestFor: string;
}

export interface CanvasAgentDraftRecommendedColor {
  name: string;
  label: string;
  usage: string;
}

export interface CanvasDraftSpec {
  kind: "diagram" | "code";
  title: string;
  summary: string;
  sourceShapeIds: string[];
  sourceRevisions: Record<string, number>;
  availableColors: CanvasAgentDraftColorOption[];
  recommendedColors: CanvasAgentDraftRecommendedColor[];
  nodes: CanvasAgentDraftNode[];
  connections: CanvasAgentDraftConnection[];
  toolSteps: CanvasAgentDraftToolStep[];
}

export interface CanvasAgentRunPayload {
  id: string;
  workspaceId: string;
  canvasId: string;
  presentationMode: CanvasAgentPresentationMode;
  status: CanvasAgentRunStatus;
  prompt: string;
  message: string | null;
  summary: string | null;
  canvasRevision: number | null;
  progress: CanvasAgentProgressPayload | null;
  artifact: CanvasAgentHtmlArtifact | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
}

export interface CanvasAgentStepPayload {
  id: string;
  order: number;
  actionName: CanvasAgentActionName;
  status: CanvasAgentStepStatus;
  resourceRefs: string[];
  completedAt: string | null;
}

export interface CanvasAgentDraftPayload {
  id: string;
  status: CanvasAgentDraftStatus;
  summary: string;
  spec: CanvasDraftSpec;
  appliedShapeIds: string[];
  appliedAt: string | null;
  expiresAt: string;
}

export interface CanvasAgentRunDetailPayload {
  run: CanvasAgentRunPayload;
  steps: CanvasAgentStepPayload[];
  drafts: CanvasAgentDraftPayload[];
}

export interface CanvasAgentDraftApplyPayload {
  draft: CanvasAgentDraftPayload;
  latestOpSeq: number;
  batch: CanvasShapeBatchPayload;
}

export interface CanvasAgentPlannedAction {
  actionName: CanvasAgentActionName;
  input: Record<string, unknown>;
  message: string;
  showProgress?: boolean;
}
