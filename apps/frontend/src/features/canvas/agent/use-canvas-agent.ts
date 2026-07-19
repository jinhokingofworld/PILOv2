"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { createCanvasAgentClient } from "../api/canvas-agent-client";
import type {
  CanvasAgentConversationContext,
  CanvasAgentDraft,
  CanvasAgentPresentationMode,
  CanvasAgentProgress,
  CanvasAgentRun,
  CanvasAgentSelectedScene,
  CanvasAgentViewport,
} from "../api/canvas-agent-types";
import {
  dispatchCanvasAgentToolTarget,
  readCanvasAgentToolHelpOverview,
  resolveCanvasAgentToolTarget,
} from "./canvas-agent-tool-targets";
import { focusCanvasAgentResult } from "./canvas-agent-camera";
import { insertCanvasAgentHtmlArtifact } from "./canvas-agent-html-insertion";
import { buildCanvasAgentShapeSummaries } from "./canvas-agent-shape-context";
import {
  buildCanvasAgentSelectedScene,
  CanvasAgentSelectedSceneError,
} from "./canvas-agent-selected-scene";

const ACTIVE_STATUSES = new Set(["queued", "planning", "executing"]);
const COMPLETED_PROGRESS_HIDE_DELAY_MS = 8000;
const LONG_RUNNING_NOTICE_DELAY_MS = 25_000;
function buildLastTaskContext(run: CanvasAgentRun | null, draft: CanvasAgentDraft | null) {
  if (!run) return null;
  return {
    draftId: draft?.id ?? null,
    draftTitle: draft?.spec.title ?? null,
    prompt: run.prompt,
    status: run.status,
    summary: run.summary ?? run.message ?? null,
  };
}

export function useCanvasAgent({
  canvasId,
  editor,
  enabled,
  onApplied,
  onDriveFileInsert,
  onFrameSubtreeRequest,
  workspaceId,
}: {
  canvasId: string;
  editor: Editor | null;
  enabled: boolean;
  onApplied: () => void;
  onDriveFileInsert: (file: {
    fileId: string;
    fileName: string;
    mimeType: string;
  }, runId: string) => boolean;
  onFrameSubtreeRequest?: (frameId: string) => Promise<void> | void;
  workspaceId: string;
}) {
  const client = useMemo(() => createCanvasAgentClient(), []);
  const [run, setRun] = useState<CanvasAgentRun | null>(null);
  const [draft, setDraft] = useState<CanvasAgentDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const selectedSceneByRunIdRef = useRef(new Map<string, CanvasAgentSelectedScene>());
  const insertedHtmlArtifactRunIdsRef = useRef(new Set<string>());
  const insertedDriveFileRunIdsRef = useRef(new Set<string>());
  const focusRetryTimerRef = useRef<number | null>(null);
  const progressHideTimerRef = useRef<number | null>(null);
  const longRunningTimerRef = useRef<number | null>(null);
  const [visibleProgress, setVisibleProgress] = useState<CanvasAgentProgress | null>(null);

  const clearProgressHideTimer = useCallback(() => {
    if (progressHideTimerRef.current === null) return;
    window.clearTimeout(progressHideTimerRef.current);
    progressHideTimerRef.current = null;
  }, []);

  const clearLongRunningTimer = useCallback(() => {
    if (longRunningTimerRef.current === null) return;
    window.clearTimeout(longRunningTimerRef.current);
    longRunningTimerRef.current = null;
  }, []);

  const clearFocusRetryTimer = useCallback(() => {
    if (focusRetryTimerRef.current === null) return;
    window.clearTimeout(focusRetryTimerRef.current);
    focusRetryTimerRef.current = null;
  }, []);

  const presentRun = useCallback(
    (nextRun: CanvasAgentRun) => {
      setRun(nextRun);
      if (
        nextRun.presentationMode !== "background" &&
        nextRun.clientAction?.type === "insert_drive_file" &&
        !insertedDriveFileRunIdsRef.current.has(nextRun.id) &&
        onDriveFileInsert(nextRun.clientAction.file, nextRun.id)
      ) {
        insertedDriveFileRunIdsRef.current.add(nextRun.id);
      }
      if (
        editor &&
        nextRun.artifact?.kind === "html" &&
        !insertedHtmlArtifactRunIdsRef.current.has(nextRun.id)
      ) {
        const selectedScene = selectedSceneByRunIdRef.current.get(nextRun.id);
        if (selectedScene) {
          const insertion = insertCanvasAgentHtmlArtifact(
            editor,
            nextRun.id,
            nextRun.artifact,
            selectedScene,
          );
          if (insertion) {
            insertedHtmlArtifactRunIdsRef.current.add(nextRun.id);
            selectedSceneByRunIdRef.current.delete(nextRun.id);
          }
        }
      }
      const progress = nextRun.presentationMode === "background" ? null : nextRun.progress;
      clearProgressHideTimer();
      if (!ACTIVE_STATUSES.has(nextRun.status)) {
        clearLongRunningTimer();
      }
      setVisibleProgress(progress);
      if (progress && !ACTIVE_STATUSES.has(nextRun.status)) {
        progressHideTimerRef.current = window.setTimeout(() => {
          setVisibleProgress((currentProgress) =>
            currentProgress === progress ? null : currentProgress,
          );
          progressHideTimerRef.current = null;
        }, COMPLETED_PROGRESS_HIDE_DELAY_MS);
      }
      clearFocusRetryTimer();
      if (!editor || !progress) return;

      if (progress.toolTarget) {
        dispatchCanvasAgentToolTarget(progress.toolTarget);
      }
      if (progress.highlightedShapeIds.length) {
        editor.select(...(progress.highlightedShapeIds as TLShapeId[]));
      }
      if (progress.targetViewport || progress.highlightedShapeIds.length) {
        const usedLoadedBounds = focusCanvasAgentResult(
          editor,
          progress.highlightedShapeIds,
          progress.targetViewport,
        );
        if (!usedLoadedBounds && progress.highlightedShapeIds.length) {
          focusRetryTimerRef.current = window.setTimeout(() => {
            focusCanvasAgentResult(editor, progress.highlightedShapeIds, null);
            focusRetryTimerRef.current = null;
          }, 800);
        }
      }
    },
    [
      clearFocusRetryTimer,
      clearLongRunningTimer,
      clearProgressHideTimer,
      editor,
      onDriveFileInsert,
    ],
  );

  const submit = useCallback(
    async (
      prompt: string,
      options?: {
        conversationContext?: Pick<CanvasAgentConversationContext, "messages">;
        presentationMode?: CanvasAgentPresentationMode;
        toolHelpMode?: boolean;
      },
    ) => {
      if (!editor) {
        setError("Canvas API 연결 후 Canvas AI를 사용할 수 있습니다.");
        return;
      }
      setError(null);
      setLocalMessage(null);
      setRun(null);
      setDraft(null);
      clearProgressHideTimer();
      clearLongRunningTimer();
      setVisibleProgress(null);

      if (options?.toolHelpMode) {
        const toolResolution = resolveCanvasAgentToolTarget(prompt);
        if (toolResolution) {
          const now = new Date().toISOString();
          const message = toolResolution.mode === "explain"
            ? toolResolution.tool.description
            : toolResolution.tool.message;
          presentRun({
            id: `local-canvas-agent-${crypto.randomUUID()}`,
            workspaceId,
            canvasId,
            presentationMode: "interactive",
            status: "completed",
            prompt,
            message,
            summary: message,
            canvasRevision: null,
            progress: toolResolution.mode === "guide"
              ? {
                  message,
                  highlightedShapeIds: [],
                  targetViewport: null,
                  toolTarget: toolResolution.tool.target,
                  toolTargetLabel: toolResolution.tool.label,
                }
              : null,
            artifact: null,
            clientAction: null,
            createdAt: now,
            completedAt: now,
            expiresAt: now,
          });
          return;
        }

        const overview = readCanvasAgentToolHelpOverview(prompt);
        if (overview) {
          const now = new Date().toISOString();
          presentRun({
            id: `local-canvas-agent-${crypto.randomUUID()}`,
            workspaceId,
            canvasId,
            presentationMode: "interactive",
            status: "completed",
            prompt,
            message: overview,
            summary: overview,
            canvasRevision: null,
            progress: null,
            artifact: null,
            clientAction: null,
            createdAt: now,
            completedAt: now,
            expiresAt: now,
          });
          return;
        }

        const now = new Date().toISOString();
        const message =
          "아직 알고 있는 Canvas 기능과 맞지 않아요. 메모, 도형, 색상, 휴지통처럼 툴바에 있는 기능 이름으로 물어봐 주세요.";
        presentRun({
          id: `local-canvas-agent-${crypto.randomUUID()}`,
          workspaceId,
          canvasId,
          presentationMode: "interactive",
          status: "completed",
          prompt,
          message,
          summary: message,
          canvasRevision: null,
          progress: null,
          artifact: null,
          clientAction: null,
          createdAt: now,
          completedAt: now,
          expiresAt: now,
        });
        return;
      }

      if (!enabled) {
        setError("Canvas API 연결 후 Canvas AI를 사용할 수 있습니다.");
        return;
      }

      const viewportBounds = editor.getViewportPageBounds();
      const viewport: CanvasAgentViewport = {
        x: viewportBounds.x,
        y: viewportBounds.y,
        width: viewportBounds.w,
        height: viewportBounds.h,
      };
      const conversationContext: CanvasAgentConversationContext | undefined =
        (options?.conversationContext || run)
          ? {
              messages: options?.conversationContext?.messages ?? [],
              lastTask: buildLastTaskContext(run, draft),
            }
          : undefined;
      try {
        let selectedScene: CanvasAgentSelectedScene | null = null;
        let selectedSceneError: string | null = null;
        try {
          selectedScene = buildCanvasAgentSelectedScene(editor);
        } catch (sceneError) {
          if (
            sceneError instanceof CanvasAgentSelectedSceneError
            && sceneError.missingFrameIds.length
            && onFrameSubtreeRequest
          ) {
            setLocalMessage("선택 영역을 불러오는 중입니다.");
            try {
              await Promise.all(
                sceneError.missingFrameIds.map((frameId) => onFrameSubtreeRequest(frameId)),
              );
              await waitForCanvasEditorHydration();
              selectedScene = buildCanvasAgentSelectedScene(editor);
            } catch (hydrationError) {
              selectedSceneError = hydrationError instanceof CanvasAgentSelectedSceneError
                ? hydrationError.message
                : "선택 영역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
            } finally {
              setLocalMessage(null);
            }
          } else {
            selectedSceneError = sceneError instanceof CanvasAgentSelectedSceneError
              ? sceneError.message
              : "선택 영역을 코드 생성용으로 읽지 못했습니다.";
          }
        }
        const shapeSummaries = buildCanvasAgentShapeSummaries(editor);
        const selectedShapeIds = editor.getSelectedShapeIds().map(String);
        const result = await client.createRun(workspaceId, canvasId, {
          prompt,
          conversationContext,
          presentationMode: options?.presentationMode ?? "interactive",
          selectedShapeIds,
          selectedScene,
          selectedSceneError,
          shapeSummaries: selectedShapeIds.length ? shapeSummaries.slice(0, 20) : shapeSummaries,
          viewport,
          toolHelpMode: options?.toolHelpMode === true,
          clientRequestId: crypto.randomUUID(),
        });
        runIdRef.current = result.run.id;
        if (selectedScene) {
          selectedSceneByRunIdRef.current.set(result.run.id, selectedScene);
        }
        presentRun(result.run);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Canvas AI 요청에 실패했습니다.");
      }
    },
    [
      canvasId,
      clearLongRunningTimer,
      clearProgressHideTimer,
      client,
      draft,
      editor,
      enabled,
      onFrameSubtreeRequest,
      presentRun,
      run,
      workspaceId,
    ],
  );

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return;
    try {
      const result = await client.cancelRun(workspaceId, canvasId, runIdRef.current);
      presentRun(result.run);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Canvas AI 작업을 취소하지 못했습니다.");
    }
  }, [canvasId, client, presentRun, workspaceId]);

  const adoptRun = useCallback(
    (nextRun: CanvasAgentRun, selectedScene: CanvasAgentSelectedScene | null) => {
      runIdRef.current = nextRun.id;
      if (selectedScene) {
        selectedSceneByRunIdRef.current.set(nextRun.id, selectedScene);
      }
      presentRun(nextRun);
    },
    [presentRun],
  );

  const applyDraft = useCallback(async () => {
    if (!draft) return;
    try {
      const result = await client.applyDraft(workspaceId, canvasId, draft.id, crypto.randomUUID());
      setDraft(result.draft);
      onApplied();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Canvas AI 초안을 적용하지 못했습니다.");
    }
  }, [canvasId, client, draft, onApplied, workspaceId]);

  const discardDraft = useCallback(async () => {
    if (!draft) return;
    try {
      const result = await client.discardDraft(workspaceId, canvasId, draft.id);
      setDraft(result.draft);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Canvas AI 초안을 폐기하지 못했습니다.");
    }
  }, [canvasId, client, draft, workspaceId]);

  const runStatus = run?.status ?? null;

  useEffect(() => {
    const runId = runIdRef.current;
    if (!runId || !runStatus || !ACTIVE_STATUSES.has(runStatus)) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const detail = await client.getRun(workspaceId, canvasId, runId);
        if (cancelled) return;
        presentRun(detail.run);
        const preview = detail.drafts.find((item) => item.status === "preview") ?? null;
        if (preview) setDraft(preview);
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Canvas AI 상태를 불러오지 못했습니다.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canvasId, client, presentRun, runStatus, workspaceId]);

  useEffect(() => {
    if (!runStatus || !ACTIVE_STATUSES.has(runStatus)) {
      clearLongRunningTimer();
      return undefined;
    }

    clearLongRunningTimer();
    longRunningTimerRef.current = window.setTimeout(() => {
      setVisibleProgress((currentProgress) => currentProgress
        ? {
            ...currentProgress,
            message: "Canvas AI 작업이 예상보다 오래 걸리고 있어요. 잠시 더 기다리거나 취소할 수 있습니다.",
          }
        : {
            message: "Canvas AI 작업이 예상보다 오래 걸리고 있어요. 잠시 더 기다리거나 취소할 수 있습니다.",
            highlightedShapeIds: [],
            targetViewport: null,
            toolTarget: null,
            toolTargetLabel: null,
          });
      longRunningTimerRef.current = null;
    }, LONG_RUNNING_NOTICE_DELAY_MS);

    return () => clearLongRunningTimer();
  }, [clearLongRunningTimer, runStatus]);

  useEffect(() => () => {
    clearFocusRetryTimer();
    clearProgressHideTimer();
    clearLongRunningTimer();
  }, [clearFocusRetryTimer, clearLongRunningTimer, clearProgressHideTimer]);

  const message = error
    ?? localMessage
    ?? run?.progress?.message
    ?? run?.message
    ?? null;

  return {
    applyDraft,
    adoptRun,
    cancel,
    discardDraft,
    draft: draft?.status === "preview" ? draft : null,
    error,
    isRunning: run ? ACTIVE_STATUSES.has(run.status) : false,
    message,
    artifact: run?.artifact ?? null,
    progress: visibleProgress,
    presentationMode: run?.presentationMode ?? "interactive",
    submit,
  };
}

function waitForCanvasEditorHydration() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 120));
}
