type Camera = { x: number; y: number; z: number };

export function createCanvasWorkspaceLocation(canvasId: string, camera: Camera) {
  return {
    context: { canvasId },
    page: "canvas" as const,
    route: {
      pathname: "/canvas",
      search: `?canvasId=${encodeURIComponent(canvasId)}`,
    },
    viewport: { kind: "camera" as const, ...camera },
  };
}

export function readCanvasCamera(
  location: {
    context: Record<string, string | null>;
    viewport: { kind: string; x?: number; y?: number; z?: number };
  },
  canvasId: string,
): Camera | null {
  const { viewport } = location;
  if (
    location.context.canvasId !== canvasId ||
    viewport.kind !== "camera" ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.z)
  ) {
    return null;
  }
  return { x: viewport.x!, y: viewport.y!, z: viewport.z! };
}
