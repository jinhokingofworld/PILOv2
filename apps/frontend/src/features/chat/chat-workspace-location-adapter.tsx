"use client";

import { useEffect, useMemo } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import {
  createChatWorkspaceLocation,
  getChatScrollOffset,
  readChatTarget,
  waitForChatScrollTarget,
} from "./chat-workspace-location";

function findChatScroller(messageId: string | null) {
  const scroller = document.querySelector<HTMLElement>(
    '[data-workspace-follow-surface="chat-messages"]',
  );
  if (!scroller) return null;
  if (messageId) {
    const message = document.getElementById(`chat-message-${messageId}`);
    if (
      !message ||
      scroller.dataset.workspaceFollowTargetReady !== messageId
    ) {
      return null;
    }
  }
  return scroller;
}

export function ChatWorkspaceLocationAdapter({
  selectedMessageId,
}: {
  selectedMessageId: string | null;
}) {
  const adapter = useMemo(
    () => ({
      capture() {
        const scroller = findChatScroller(selectedMessageId);
        if (!scroller) return null;
        return createChatWorkspaceLocation(selectedMessageId, {
          clientHeight: scroller.clientHeight,
          clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight,
          scrollLeft: scroller.scrollLeft,
          scrollTop: scroller.scrollTop,
          scrollWidth: scroller.scrollWidth,
        });
      },
      page: "chat" as const,
      ready: true,
      async restore(
        location: WorkspacePresenceLocation,
        { signal }: { signal: AbortSignal },
      ) {
        const target = readChatTarget(location);
        if (
          !target ||
          signal.aborted ||
          target.messageId !== selectedMessageId
        ) {
          return false;
        }
        const scroller = await waitForChatScrollTarget({
          findTarget: () => findChatScroller(target.messageId),
          messageId: target.messageId,
          signal,
          timeoutMs: 5_000,
        });
        if (!scroller || signal.aborted) return false;
        scroller.scrollTo(
          getChatScrollOffset(target.viewport, {
            clientHeight: scroller.clientHeight,
            clientWidth: scroller.clientWidth,
            scrollHeight: scroller.scrollHeight,
            scrollWidth: scroller.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [selectedMessageId],
  );
  const { reportLocationChange } = useWorkspaceLocationAdapter(adapter);

  useEffect(() => {
    const controller = new AbortController();
    void waitForChatScrollTarget({
      findTarget: () => findChatScroller(selectedMessageId),
      messageId: selectedMessageId,
      signal: controller.signal,
      timeoutMs: 5_000,
    }).then((target) => {
      if (target && !controller.signal.aborted) reportLocationChange();
    });
    return () => controller.abort();
  }, [reportLocationChange, selectedMessageId]);

  return null;
}
