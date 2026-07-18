type Camera = { x: number; y: number; z: number };

type CanvasLocationLike = {
  context: Record<string, string | null>;
  viewport: {
    kind: string;
    selectedShapeIds?: unknown;
    x?: number;
    y?: number;
    z?: number;
  };
};

function readSelectedShapeIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const selectedShapeIds = value.map((shapeId) =>
    typeof shapeId === "string" ? shapeId.trim() : "",
  );
  return selectedShapeIds.every(Boolean) ? selectedShapeIds : null;
}

export function createCanvasWorkspaceLocation(
  canvasId: string,
  camera: Camera,
  selectedShapeIds: string[] = [],
) {
  return {
    context: { canvasId },
    page: "canvas" as const,
    route: {
      pathname: "/canvas",
      search: `?canvasId=${encodeURIComponent(canvasId)}`,
    },
    viewport: {
      kind: "camera" as const,
      selectedShapeIds,
      ...camera,
    },
  };
}

export function readCanvasWorkspaceTarget(
  location: CanvasLocationLike,
  canvasId: string,
): { camera: Camera; selectedShapeIds: string[] } | null {
  const { viewport } = location;
  const selectedShapeIds = readSelectedShapeIds(viewport.selectedShapeIds);
  if (
    location.context.canvasId !== canvasId ||
    viewport.kind !== "camera" ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.z) ||
    !selectedShapeIds
  ) {
    return null;
  }
  return {
    camera: { x: viewport.x!, y: viewport.y!, z: viewport.z! },
    selectedShapeIds,
  };
}

export function readCanvasCamera(
  location: {
    context: Record<string, string | null>;
    viewport: { kind: string; x?: number; y?: number; z?: number };
  },
  canvasId: string,
): Camera | null {
  return readCanvasWorkspaceTarget(location, canvasId)?.camera ?? null;
}
