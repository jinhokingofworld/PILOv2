import type { SqltoerdModelJsonV1 } from "@/features/sql-erd/types";

export type SqlErdCanvasShapeIdentity = {
  id: string;
  type: string;
};

export type SqlErdCanvasCameraSyncMode =
  | "fit_canvas"
  | "preserve_camera";

export function createSqlErdCanvasContentKey({
  modelJson,
  sessionId
}: {
  modelJson: SqltoerdModelJsonV1;
  sessionId?: string | null;
}) {
  return JSON.stringify({
    schema: modelJson.schema,
    sessionId: sessionId ?? null
  });
}

export function getSqlErdCanvasCameraSyncMode(
  previousContentKey: string,
  nextContentKey: string
): SqlErdCanvasCameraSyncMode {
  return previousContentKey === nextContentKey
    ? "preserve_camera"
    : "fit_canvas";
}

export type SqlErdCanvasContentSyncState = {
  contentKey: string;
  fitRequestVersion: number;
};

export function createSqlErdCanvasContentSyncState(
  contentKey: string
): SqlErdCanvasContentSyncState {
  return { contentKey, fitRequestVersion: 0 };
}

export function invalidateSqlErdCanvasContentSyncFits(
  state: SqlErdCanvasContentSyncState
) {
  state.fitRequestVersion += 1;
}

export function syncSqlErdCanvasContent({
  contentKey,
  onFit,
  scheduleFit,
  state,
  syncShapes
}: {
  contentKey: string;
  onFit: () => void;
  scheduleFit: (callback: () => void) => unknown;
  state: SqlErdCanvasContentSyncState;
  syncShapes: () => void;
}) {
  const cameraSyncMode = getSqlErdCanvasCameraSyncMode(
    state.contentKey,
    contentKey
  );

  state.contentKey = contentKey;
  syncShapes();

  if (cameraSyncMode === "fit_canvas") {
    const fitRequestVersion = ++state.fitRequestVersion;

    scheduleFit(() => {
      if (fitRequestVersion === state.fitRequestVersion) {
        onFit();
      }
    });
  }

  return cameraSyncMode;
}

type SqlErdCanvasIncrementalSyncEditor<
  CurrentShape extends SqlErdCanvasShapeIdentity,
  NextShape extends SqlErdCanvasShapeIdentity,
  Camera
> = {
  createShapes: (shapes: NextShape[]) => unknown;
  deleteShapes: (shapeIds: CurrentShape["id"][]) => unknown;
  getCamera: () => Camera;
  run: (callback: () => void, options: { history: "ignore" }) => unknown;
  setCamera: (camera: Camera) => unknown;
  updateShapes: (shapes: NextShape[]) => unknown;
};

export function createSqlErdCanvasIncrementalShapeSyncPlan<
  CurrentShape extends SqlErdCanvasShapeIdentity,
  NextShape extends SqlErdCanvasShapeIdentity
>(
  currentShapes: readonly CurrentShape[],
  nextShapes: readonly NextShape[]
) {
  const currentShapeById = new Map(
    currentShapes.map((shape) => [shape.id, shape])
  );
  const nextShapeById = new Map(nextShapes.map((shape) => [shape.id, shape]));

  const shapeIdsToDelete = currentShapes
    .filter((shape) => {
      const nextShape = nextShapeById.get(shape.id);

      return !nextShape || nextShape.type !== shape.type;
    })
    .map((shape) => shape.id);
  const shapesToCreate = nextShapes.filter((shape) => {
    const currentShape = currentShapeById.get(shape.id);

    return !currentShape || currentShape.type !== shape.type;
  });
  const shapesToUpdate = nextShapes.filter((shape) => {
    const currentShape = currentShapeById.get(shape.id);

    return !!currentShape && currentShape.type === shape.type;
  });

  return { shapeIdsToDelete, shapesToCreate, shapesToUpdate };
}

export function applySqlErdCanvasIncrementalShapeSync<
  CurrentShape extends SqlErdCanvasShapeIdentity,
  NextShape extends SqlErdCanvasShapeIdentity,
  Camera
>({
  currentShapes,
  editor,
  nextShapes,
  onAfterSync,
  shapesToUpdate
}: {
  currentShapes: readonly CurrentShape[];
  editor: SqlErdCanvasIncrementalSyncEditor<CurrentShape, NextShape, Camera>;
  nextShapes: readonly NextShape[];
  onAfterSync?: () => void;
  shapesToUpdate: NextShape[];
}) {
  const plan = createSqlErdCanvasIncrementalShapeSyncPlan(
    currentShapes,
    nextShapes
  );

  if (
    !plan.shapeIdsToDelete.length &&
    !plan.shapesToCreate.length &&
    !shapesToUpdate.length
  ) {
    return plan;
  }

  const camera = editor.getCamera();

  editor.run(
    () => {
      if (plan.shapeIdsToDelete.length) {
        editor.deleteShapes(plan.shapeIdsToDelete);
      }

      if (plan.shapesToCreate.length) {
        editor.createShapes(plan.shapesToCreate);
      }

      if (shapesToUpdate.length) {
        editor.updateShapes(shapesToUpdate);
      }

      onAfterSync?.();
    },
    { history: "ignore" }
  );

  editor.setCamera(camera);

  return plan;
}
