type SessionWithId = { id: string };

export function getCurrentScreenShareSnapshotOutcome({
  session,
  viewerSessionId
}: {
  session: SessionWithId | null;
  viewerSessionId: string | null;
}) {
  return {
    shouldDisconnectViewer:
      viewerSessionId !== null &&
      viewerSessionId !== session?.id
  };
}
