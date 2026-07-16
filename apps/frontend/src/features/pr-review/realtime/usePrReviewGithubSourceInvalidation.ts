"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import {
  createPrReviewGithubSourceLifecycle,
  type PrReviewGithubSourceSocket
} from "./pr-review-github-source-lifecycle";

const LOCAL_REALTIME_SERVER_URL = "http://localhost:3001";

function getRealtimeServerUrl() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_PILO_REALTIME_SERVER_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }
  return process.env.NODE_ENV === "production"
    ? null
    : LOCAL_REALTIME_SERVER_URL;
}

export function usePrReviewGithubSourceInvalidation({
  authToken,
  pullRequestId,
  refreshPullRequest,
  workspaceId
}: {
  authToken: string | null;
  pullRequestId: string;
  refreshPullRequest: () => void | Promise<unknown>;
  workspaceId: string;
}) {
  const refreshRef = useRef(refreshPullRequest);

  useEffect(() => {
    refreshRef.current = refreshPullRequest;
  }, [refreshPullRequest]);

  useEffect(() => {
    const normalizedAuthToken = authToken?.trim() ?? "";
    const normalizedPullRequestId = pullRequestId.trim().toLowerCase();
    const normalizedWorkspaceId = workspaceId.trim().toLowerCase();
    const realtimeServerUrl = getRealtimeServerUrl();
    if (
      !normalizedAuthToken ||
      !normalizedPullRequestId ||
      !normalizedWorkspaceId ||
      !realtimeServerUrl
    ) {
      return;
    }

    const socket = io(realtimeServerUrl, {
      auth: { token: normalizedAuthToken },
      autoConnect: false,
      transports: ["websocket"]
    }) as PrReviewGithubSourceSocket;
    const lifecycle = createPrReviewGithubSourceLifecycle({
      pullRequestId: normalizedPullRequestId,
      refreshPullRequest: () => refreshRef.current(),
      socket,
      workspaceId: normalizedWorkspaceId
    });
    lifecycle.connect();
    return lifecycle.cleanup;
  }, [authToken, pullRequestId, workspaceId]);
}
