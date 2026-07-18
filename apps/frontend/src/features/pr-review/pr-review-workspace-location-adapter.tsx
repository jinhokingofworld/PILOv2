"use client";

import { useEffect, useMemo } from "react";
import { useEditor } from "tldraw";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import {
  createPrReviewReadyLocationReporter,
  createPrReviewDiffLocation,
  getPrReviewScrollOffset,
  readPrReviewDiffTarget,
  waitForPrReviewScrollTarget,
  type PrReviewFollowSurfaceKey,
} from "./pr-review-follow-location";
import {
  createPrReviewDocumentWorkspaceLocation,
  createPrReviewWorkspaceLocation,
  getPrReviewDocumentScrollOffset,
  readPrReviewCamera,
} from "./pr-review-workspace-location";

function getDocumentScroller() {
  return document.scrollingElement ?? document.documentElement;
}

function findPrReviewScrollTarget(
  reviewFileId: string,
  surface: PrReviewFollowSurfaceKey,
) {
  const candidates = document.querySelectorAll<HTMLElement>(
    "[data-workspace-follow-review-file-id][data-workspace-follow-surface]",
  );
  for (const element of candidates) {
    const candidateReviewFileId =
      element.dataset.workspaceFollowReviewFileId;
    const candidateSurface = element.dataset.workspaceFollowSurface;
    if (
      candidateReviewFileId === reviewFileId &&
      candidateSurface === surface
    ) {
      return {
        element:
          element.querySelector<HTMLElement>(".cm-scroller") ?? element,
        reviewFileId: candidateReviewFileId,
        surface: candidateSurface,
      };
    }
  }
  return null;
}

export function PrReviewDocumentWorkspaceLocationAdapter() {
  const adapter = useMemo(
    () => ({
      capture() {
        const scroller = getDocumentScroller();
        return createPrReviewDocumentWorkspaceLocation({
          clientHeight: scroller.clientHeight,
          clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight,
          scrollLeft: scroller.scrollLeft,
          scrollTop: scroller.scrollTop,
          scrollWidth: scroller.scrollWidth,
        });
      },
      page: "pr-review" as const,
      ready: true,
      restore(location: WorkspacePresenceLocation) {
        if (
          location.page !== "pr-review" ||
          location.context.reviewSessionId !== null ||
          location.viewport.kind !== "document"
        ) {
          return false;
        }
        const scroller = getDocumentScroller();
        window.scrollTo(
          getPrReviewDocumentScrollOffset(location.viewport, {
            clientHeight: scroller.clientHeight,
            clientWidth: scroller.clientWidth,
            scrollHeight: scroller.scrollHeight,
            scrollWidth: scroller.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}

export function PrReviewWorkspaceLocationAdapter({
  activeFollowSurface,
  onFollowSurfaceChange,
  onOpenedReviewFileChange,
  openedReviewFileId,
  reviewSessionId,
}: {
  activeFollowSurface: PrReviewFollowSurfaceKey;
  onFollowSurfaceChange: (surface: PrReviewFollowSurfaceKey) => void;
  onOpenedReviewFileChange: (reviewFileId: string | null) => void;
  openedReviewFileId: string | null;
  reviewSessionId: string;
}) {
  const editor = useEditor();
  const readyLocationReporter = useMemo(
    () => createPrReviewReadyLocationReporter(),
    [],
  );
  const adapter = useMemo(
    () => ({
      capture() {
        if (openedReviewFileId) {
          const target = findPrReviewScrollTarget(
            openedReviewFileId,
            activeFollowSurface,
          );
          if (target) {
            return createPrReviewDiffLocation({
              metrics: {
                clientHeight: target.element.clientHeight,
                clientWidth: target.element.clientWidth,
                scrollHeight: target.element.scrollHeight,
                scrollLeft: target.element.scrollLeft,
                scrollTop: target.element.scrollTop,
                scrollWidth: target.element.scrollWidth,
              },
              reviewFileId: openedReviewFileId,
              reviewSessionId,
              surface: activeFollowSurface,
            });
          }
        }
        return createPrReviewWorkspaceLocation(
          reviewSessionId,
          editor.getCamera(),
        );
      },
      page: "pr-review" as const,
      ready: Boolean(reviewSessionId),
      async restore(
        location: WorkspacePresenceLocation,
        { signal }: { signal: AbortSignal },
      ) {
        if (signal.aborted) return false;
        const diffTarget = readPrReviewDiffTarget(location, reviewSessionId);
        if (diffTarget) {
          onOpenedReviewFileChange(diffTarget.reviewFileId);
          onFollowSurfaceChange(diffTarget.surface);
          const scroller = await waitForPrReviewScrollTarget({
            findTarget: () =>
              findPrReviewScrollTarget(
                diffTarget.reviewFileId,
                diffTarget.surface,
              ),
            reviewFileId: diffTarget.reviewFileId,
            signal,
            surface: diffTarget.surface,
            timeoutMs: 5_000,
          });
          if (!scroller || signal.aborted) return false;
          scroller.scrollTo(
            getPrReviewScrollOffset(diffTarget.viewport, {
              clientHeight: scroller.clientHeight,
              clientWidth: scroller.clientWidth,
              scrollHeight: scroller.scrollHeight,
              scrollWidth: scroller.scrollWidth,
            }),
          );
          return true;
        }

        const camera = readPrReviewCamera(location, reviewSessionId);
        if (!camera) return false;
        if (signal.aborted) return false;
        onOpenedReviewFileChange(null);
        editor.setCamera(camera);
        return true;
      },
    }),
    [
      activeFollowSurface,
      editor,
      onFollowSurfaceChange,
      onOpenedReviewFileChange,
      openedReviewFileId,
      reviewSessionId,
    ],
  );
  const { reportInteraction, reportLocationChange } =
    useWorkspaceLocationAdapter(adapter);
  useEffect(() => {
    const reviewFileId = openedReviewFileId;
    if (!reviewFileId) {
      readyLocationReporter.cancel();
      return;
    }

    void readyLocationReporter.reportWhenReady({
      findTarget: () =>
        findPrReviewScrollTarget(reviewFileId, activeFollowSurface),
      reportLocationChange,
      reviewFileId,
      surface: activeFollowSurface,
      timeoutMs: 5_000,
    });
    return () => readyLocationReporter.cancel();
  }, [
    activeFollowSurface,
    openedReviewFileId,
    readyLocationReporter,
    reportLocationChange,
  ]);
  useEffect(() => {
    window.addEventListener("pointerup", reportInteraction);
    window.addEventListener("wheel", reportInteraction, { passive: true });
    return () => {
      window.removeEventListener("pointerup", reportInteraction);
      window.removeEventListener("wheel", reportInteraction);
    };
  }, [reportInteraction]);
  return null;
}
