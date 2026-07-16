type Camera = { x: number; y: number; z: number };

export function createSqlErdWorkspaceLocation(sessionId: string, camera: Camera) {
  return {
    context: { sessionId },
    page: "sql-erd" as const,
    route: {
      pathname: "/sql-erd/session",
      search: `?sessionId=${encodeURIComponent(sessionId)}`,
    },
    viewport: { kind: "camera" as const, ...camera },
  };
}

export function readSqlErdCamera(
  location: {
    context: Record<string, string | null>;
    viewport: { kind: string; x?: number; y?: number; z?: number };
  },
  sessionId: string,
): Camera | null {
  const { viewport } = location;
  if (
    location.context.sessionId !== sessionId ||
    viewport.kind !== "camera" ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.z)
  ) {
    return null;
  }
  return { x: viewport.x!, y: viewport.y!, z: viewport.z! };
}
