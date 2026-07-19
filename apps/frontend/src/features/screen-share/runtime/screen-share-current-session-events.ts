type RealtimeEventSocket = {
  off: (event: string, listener: (payload: unknown) => void) => unknown;
  on: (event: string, listener: (payload: unknown) => void) => unknown;
};

type WorkspacePresenceJoinedPayload = { workspaceId: string };

function isWorkspacePresenceJoinedPayload(
  payload: unknown
): payload is WorkspacePresenceJoinedPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "workspaceId" in payload &&
    typeof payload.workspaceId === "string"
  );
}

export function bindScreenShareCurrentSessionInvalidations({
  invalidate,
  joinedEvent,
  socket,
  workspaceId
}: {
  invalidate: () => void;
  joinedEvent: string;
  socket: RealtimeEventSocket;
  workspaceId: string;
}) {
  const handleJoined = (payload: unknown) => {
    if (
      !isWorkspacePresenceJoinedPayload(payload) ||
      payload.workspaceId !== workspaceId
    ) {
      return;
    }
    invalidate();
  };
  const handleScreenShareInvalidated = () => invalidate();

  socket.on(joinedEvent, handleJoined);
  socket.on("workspace-screen-share:started", handleScreenShareInvalidated);
  socket.on("workspace-screen-share:ended", handleScreenShareInvalidated);

  return () => {
    socket.off(joinedEvent, handleJoined);
    socket.off("workspace-screen-share:started", handleScreenShareInvalidated);
    socket.off("workspace-screen-share:ended", handleScreenShareInvalidated);
  };
}
