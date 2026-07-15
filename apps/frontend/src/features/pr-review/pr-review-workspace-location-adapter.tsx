"use client";

import { useEffect, useMemo } from "react";
import { useEditor } from "tldraw";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import {
  createPrReviewDocumentWorkspaceLocation,
  createPrReviewWorkspaceLocation,
  getPrReviewDocumentScrollOffset,
  readPrReviewCamera,
} from "./pr-review-workspace-location";

function getDocumentScroller() {
  return document.scrollingElement ?? document.documentElement;
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

export function PrReviewWorkspaceLocationAdapter({ reviewSessionId }: { reviewSessionId: string }) {
  const editor = useEditor();
  const adapter = useMemo(
    () => ({
      capture: () => createPrReviewWorkspaceLocation(reviewSessionId, editor.getCamera()),
      page: "pr-review" as const,
      ready: Boolean(reviewSessionId),
      restore(location: WorkspacePresenceLocation) {
        const camera = readPrReviewCamera(location, reviewSessionId);
        if (!camera) return false;
        editor.setCamera(camera);
        return true;
      },
    }),
    [editor, reviewSessionId],
  );
  const { reportInteraction } = useWorkspaceLocationAdapter(adapter);
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
