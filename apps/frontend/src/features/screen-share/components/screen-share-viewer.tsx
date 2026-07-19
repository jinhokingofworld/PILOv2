"use client";

import { useEffect, useRef, useState } from "react";
import {
  Expand,
  Maximize,
  Minimize2,
  PictureInPicture2,
  X
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useScreenShareRuntime } from "@/features/screen-share/runtime/screen-share-runtime-provider";
import type { ViewerMode } from "@/features/screen-share/runtime/screen-share-reducer";
import { cn } from "@/lib/utils";

// <screen-share-viewer-pure>
type ViewerPolicyMode = "floating" | "focus" | "fullscreen";
type ViewerPolicyEvent = "expand" | "fullscreen" | "browser-exit" | "escape";

export function getNextScreenShareViewerMode(
  mode: ViewerPolicyMode,
  event: ViewerPolicyEvent
): ViewerPolicyMode {
  if (event === "expand" && mode === "floating") return "focus";
  if (event === "fullscreen" && mode === "focus") return "fullscreen";
  if (event === "browser-exit" && mode === "fullscreen") return "focus";
  if (event === "escape" && mode === "focus") return "floating";
  return mode;
}
// </screen-share-viewer-pure>

const FULLSCREEN_ERROR_MESSAGE = "전체 화면을 시작하지 못했어요.";

export function ScreenShareViewer() {
  const {
    activeSession,
    setViewerMode,
    stopViewing,
    viewer,
    viewerMediaElement
  } = useScreenShareRuntime();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const focusButtonRef = useRef<HTMLButtonElement | null>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  useEffect(() => {
    const host = videoHostRef.current;
    const mediaElement = viewerMediaElement;
    if (!host || !mediaElement) return;
    host.appendChild(mediaElement);
    return () => {
      if (mediaElement.parentElement === host) mediaElement.remove();
    };
  }, [viewerMediaElement]);

  useEffect(() => {
    if (viewer.mode === "focus") focusButtonRef.current?.focus();
  }, [viewer.mode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (
        viewer.mode === "fullscreen" &&
        document.fullscreenElement !== containerRef.current
      ) {
        setViewerMode(
          getNextScreenShareViewerMode("fullscreen", "browser-exit") as ViewerMode
        );
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [setViewerMode, viewer.mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && viewer.mode === "focus") {
        event.preventDefault();
        setViewerMode(
          getNextScreenShareViewerMode("focus", "escape") as ViewerMode
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setViewerMode, viewer.mode]);

  if (viewer.status === "closed") return null;

  async function enterFullscreen() {
    const container = containerRef.current;
    if (!container) return;
    setFullscreenError(null);
    try {
      await container.requestFullscreen();
      setViewerMode(
        getNextScreenShareViewerMode("focus", "fullscreen") as ViewerMode
      );
    } catch {
      setFullscreenError(FULLSCREEN_ERROR_MESSAGE);
    }
  }

  function finishViewing() {
    if (document.fullscreenElement === containerRef.current) {
      void document.exitFullscreen().finally(stopViewing);
      return;
    }
    stopViewing();
  }

  const isFloating = viewer.mode === "floating";
  const sharerName = activeSession?.id === viewer.sessionId
    ? activeSession.sharer.displayName
    : "화면 공유";

  return (
    <div
      aria-label={`${sharerName} 시청 화면`}
      aria-modal={isFloating ? undefined : true}
      className={cn(
        "flex flex-col overflow-hidden border bg-background shadow-2xl outline-none",
        isFloating &&
          "fixed bottom-4 right-4 z-50 h-[min(22rem,calc(100svh-2rem))] w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100svh-2rem)] max-w-[calc(100vw-2rem)] resize rounded-xl",
        !isFloating && "fixed inset-0 z-[70]"
      )}
      ref={containerRef}
      role={isFloating ? "region" : "dialog"}
      tabIndex={-1}
    >
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b px-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {sharerName} 시청 중
        </p>
        {isFloating ? (
          <Button
            aria-label="크게 보기"
            onClick={() => setViewerMode("focus")}
            ref={focusButtonRef}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Expand aria-hidden="true" />
          </Button>
        ) : (
          <Button
            aria-label="작게 보기"
            onClick={() => {
              if (viewer.mode === "fullscreen") {
                void document.exitFullscreen();
              } else {
                setViewerMode("floating");
              }
            }}
            ref={focusButtonRef}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {viewer.mode === "fullscreen" ? (
              <Minimize2 aria-hidden="true" />
            ) : (
              <PictureInPicture2 aria-hidden="true" />
            )}
          </Button>
        )}
        {viewer.mode === "focus" ? (
          <Button
            aria-label="전체 화면"
            onClick={() => void enterFullscreen()}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Maximize aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          aria-label="시청 종료"
          onClick={finishViewing}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div
        className="relative min-h-0 flex-1 bg-black"
        ref={videoHostRef}
      >
        {viewer.status === "connecting" ? (
          <p
            className="absolute inset-0 grid place-items-center text-sm text-white/80"
            role="status"
          >
            화면 공유 연결 중
          </p>
        ) : null}
      </div>
      {fullscreenError ? (
        <p className="border-t px-3 py-2 text-xs text-destructive" role="alert">
          {fullscreenError}
        </p>
      ) : null}
    </div>
  );
}
