"use client";

import { useMemo } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import { createHomeWorkspaceLocation, getHomeScrollOffset } from "./home-workspace-location";

function getDocumentScroller() {
  return document.scrollingElement ?? document.documentElement;
}

export function HomeWorkspaceLocationAdapter() {
  const adapter = useMemo(
    () => ({
      capture() {
        const scroller = getDocumentScroller();
        return createHomeWorkspaceLocation({
          clientHeight: scroller.clientHeight,
          clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight,
          scrollLeft: scroller.scrollLeft,
          scrollTop: scroller.scrollTop,
          scrollWidth: scroller.scrollWidth,
        });
      },
      page: "home" as const,
      ready: true,
      restore(location: WorkspacePresenceLocation) {
        if (location.page !== "home" || location.viewport.kind !== "document") {
          return false;
        }
        const scroller = getDocumentScroller();
        window.scrollTo(
          getHomeScrollOffset(location.viewport, {
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
