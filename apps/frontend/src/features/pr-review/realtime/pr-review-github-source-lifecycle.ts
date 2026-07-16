"use client";

export type PrReviewGithubSourceInvalidation = {
  repositoryId: string;
  sourceId: string;
  sourceNumber: number;
  sourceType: "issue" | "pull_request";
  updatedAt: string;
  workspaceId: string;
};

export type PrReviewGithubSourceSocket = {
  connected: boolean;
  connect: () => unknown;
  disconnect: () => unknown;
  emit: (
    event: "github:source:subscribe" | "github:source:unsubscribe",
    payload: { workspaceId: string }
  ) => unknown;
  on: {
    (event: "connect", listener: () => void): unknown;
    (
      event: "github:source:invalidated",
      listener: (payload: PrReviewGithubSourceInvalidation) => void
    ): unknown;
  };
  removeAllListeners: () => unknown;
};

export function createPrReviewGithubSourceLifecycle({
  pullRequestId,
  refreshPullRequest,
  socket,
  workspaceId
}: {
  pullRequestId: string;
  refreshPullRequest: () => void | Promise<unknown>;
  socket: PrReviewGithubSourceSocket;
  workspaceId: string;
}) {
  function requestRefresh() {
    void refreshPullRequest();
  }

  function handleConnect() {
    socket.emit("github:source:subscribe", { workspaceId });
    requestRefresh();
  }

  function handleInvalidation(event: PrReviewGithubSourceInvalidation) {
    if (
      event.workspaceId === workspaceId &&
      event.sourceType === "pull_request" &&
      event.sourceId === pullRequestId
    ) {
      requestRefresh();
    }
  }

  return {
    cleanup() {
      if (socket.connected) {
        socket.emit("github:source:unsubscribe", { workspaceId });
      }
      socket.removeAllListeners();
      socket.disconnect();
    },
    connect() {
      socket.on("connect", handleConnect);
      socket.on("github:source:invalidated", handleInvalidation);
      socket.connect();
    }
  };
}
