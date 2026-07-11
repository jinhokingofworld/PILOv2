"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { createCanvasAgentClient } from "../api/canvas-agent-client";
import type {
  CanvasAgentDraft,
  CanvasAgentProgress,
  CanvasAgentRun,
  CanvasAgentViewport,
} from "../api/canvas-agent-types";
import {
  dispatchCanvasAgentToolTarget,
  resolveCanvasAgentToolTarget,
} from "./canvas-agent-tool-targets";

const ACTIVE_STATUSES = new Set(["queued", "planning", "executing"]);
const COMPLETED_PROGRESS_HIDE_DELAY_MS = 8000;

export function useCanvasAgent({
  canvasId,
  editor,
  enabled,
  onApplied,
  workspaceId,
}: {
  canvasId: string;
  editor: Editor | null;
  enabled: boolean;
  onApplied: () => void;
  workspaceId: string;
}) {
  const client = useMemo(() => createCanvasAgentClient(), []);
  const [run, setRun] = useState<CanvasAgentRun | null>(null);
  const [draft, setDraft] = useState<CanvasAgentDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const progressHideTimerRef = useRef<number | null>(null);
  const [visibleProgress, setVisibleProgress] = useState<CanvasAgentProgress | null>(null);

  const clearProgressHideTimer = useCallback(() => {
    if (progressHideTimerRef.current === null) return;
    window.clearTimeout(progressHideTimerRef.current);
    progressHideTimerRef.current = null;
  }, []);

  const presentRun = useCallback(
    (nextRun: CanvasAgentRun) => {
      setRun(nextRun);
      const progress = nextRun.progress;
      clearProgressHideTimer();
      setVisibleProgress(progress);
      if (progress && !ACTIVE_STATUSES.has(nextRun.status)) {
        progressHideTimerRef.current = window.setTimeout(() => {
          setVisibleProgress((currentProgress) =>
            currentProgress === progress ? null : currentProgress,
          );
          progressHideTimerRef.current = null;
        }, COMPLETED_PROGRESS_HIDE_DELAY_MS);
      }
      if (!editor || !progress) return;

      if (progress.toolTarget) {
        dispatchCanvasAgentToolTarget(progress.toolTarget);
      }
      if (progress.highlightedShapeIds.length) {
        editor.select(...(progress.highlightedShapeIds as TLShapeId[]));
      }
      if (progress.targetViewport) {
        editor.zoomToBounds(
          {
            x: progress.targetViewport.x,
            y: progress.targetViewport.y,
            w: progress.targetViewport.width,
            h: progress.targetViewport.height,
          },
          { animation: { duration: 500 } },
        );
      }
    },
    [clearProgressHideTimer, editor],
  );

  const submit = useCallback(
    async (prompt: string, options?: { toolHelpMode?: boolean }) => {
      if (!editor) {
        setError("Canvas API 연결 후 Canvas AI를 사용할 수 있습니다.");
        return;
      }
      setError(null);
      setRun(null);
      setDraft(null);
      clearProgressHideTimer();
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
          status: "completed",
          prompt,
          message,
          summary: message,
          canvasRevision: null,
          progress: null,
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
      try {
        const result = await client.createRun(workspaceId, canvasId, {
          prompt,
          selectedShapeIds: editor.getSelectedShapeIds().map(String),
          viewport,
          toolHelpMode: options?.toolHelpMode === true,
          clientRequestId: crypto.randomUUID(),
        });
        runIdRef.current = result.run.id;
        presentRun(result.run);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Canvas AI 요청에 실패했습니다.");
      }
    },
    [canvasId, clearProgressHideTimer, client, editor, enabled, presentRun, workspaceId],
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

  useEffect(() => {
    const runId = runIdRef.current;
    if (!runId || !run || !ACTIVE_STATUSES.has(run.status)) return undefined;
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
  }, [canvasId, client, presentRun, run, workspaceId]);

  useEffect(() => () => clearProgressHideTimer(), [clearProgressHideTimer]);

  return {
    applyDraft,
    cancel,
    discardDraft,
    draft: draft?.status === "preview" ? draft : null,
    error,
    isRunning: run ? ACTIVE_STATUSES.has(run.status) : false,
    message: error ?? run?.progress?.message ?? run?.message ?? null,
    progress: visibleProgress,
    submit,
  };
}
