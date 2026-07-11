import { buildCanvasApiUrl, CanvasApiError } from "./canvas-api-client";
import type {
  CanvasAgentDraft,
  CanvasAgentDraftApplyResult,
  CanvasAgentPresentationMode,
  CanvasAgentRun,
  CanvasAgentRunDetail,
  CanvasAgentViewport,
} from "./canvas-agent-types";

const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

function getBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_APP_SERVER_ORIGIN
  );
}

function getToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("pilo:access-token");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const response = await fetch(buildCanvasApiUrl(path, getBaseUrl()), {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new CanvasApiError("Canvas Agent API request failed", {
      status: response.status,
      path,
    });
  }
  const payload = (await response.json()) as { data?: T };
  if (!payload || !("data" in payload)) {
    throw new CanvasApiError("Canvas Agent API returned invalid JSON", {
      status: response.status,
      path,
    });
  }
  return payload.data as T;
}

function pathBase(workspaceId: string, canvasId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(canvasId)}`;
}

export function createCanvasAgentClient() {
  return {
    createRun(
      workspaceId: string,
      canvasId: string,
      body: {
        prompt: string;
        presentationMode?: CanvasAgentPresentationMode;
        selectedShapeIds: string[];
        toolHelpMode?: boolean;
        viewport: CanvasAgentViewport;
        clientRequestId: string;
      },
    ) {
      return request<{ run: CanvasAgentRun }>(`${pathBase(workspaceId, canvasId)}/agent-runs`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    getRun(workspaceId: string, canvasId: string, runId: string) {
      return request<CanvasAgentRunDetail>(
        `${pathBase(workspaceId, canvasId)}/agent-runs/${encodeURIComponent(runId)}`,
      );
    },
    cancelRun(workspaceId: string, canvasId: string, runId: string) {
      return request<{ run: CanvasAgentRun }>(
        `${pathBase(workspaceId, canvasId)}/agent-runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST" },
      );
    },
    applyDraft(workspaceId: string, canvasId: string, draftId: string, clientOperationId: string) {
      return request<CanvasAgentDraftApplyResult>(
        `${pathBase(workspaceId, canvasId)}/agent-drafts/${encodeURIComponent(draftId)}/apply`,
        { method: "POST", body: JSON.stringify({ clientOperationId }) },
      );
    },
    discardDraft(workspaceId: string, canvasId: string, draftId: string) {
      return request<{ draft: CanvasAgentDraft }>(
        `${pathBase(workspaceId, canvasId)}/agent-drafts/${encodeURIComponent(draftId)}/discard`,
        { method: "POST" },
      );
    },
  };
}
