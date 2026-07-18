import type {
  SqltoerdModelJsonV1,
  SqltoerdTableLayout
} from "@/features/sql-erd/types";

type SqlErdPositionedTableShape = {
  props: { tableId: string };
  x: number;
  y: number;
};

type SqlErdTablePositionChangeEntry = {
  changes: {
    updated: Record<string, readonly [unknown, unknown]>;
  };
  source: "remote" | "user";
};

export type SqlErdTablePositionChangeBuffer = {
  cancel: () => void;
  clearSuppressed: () => void;
  flush: (
    resolvePosition: (tableId: string) => SqltoerdTableLayout | null
  ) => SqltoerdTableLayout[];
  record: (entry: SqlErdTablePositionChangeEntry) => string[];
  suppressNext: (tablePositions: readonly SqltoerdTableLayout[]) => void;
};

export function createSqlErdTablePositionChangeBuffer<
  TableShape extends SqlErdPositionedTableShape
>(
  isTableShape: (shape: unknown) => shape is TableShape
): SqlErdTablePositionChangeBuffer {
  const changedTableIds = new Set<string>();
  const suppressedTablePositions = new Map<
    string,
    Pick<SqltoerdTableLayout, "x" | "y">
  >();

  return {
    cancel() {
      changedTableIds.clear();
    },
    clearSuppressed() {
      suppressedTablePositions.clear();
    },
    flush(
      resolvePosition: (tableId: string) => SqltoerdTableLayout | null
    ) {
      const positions = [...changedTableIds].flatMap((tableId) => {
        const position = resolvePosition(tableId);
        return position ? [position] : [];
      });
      changedTableIds.clear();
      return positions;
    },
    record(entry: SqlErdTablePositionChangeEntry) {
      if (entry.source !== "user") {
        return [];
      }

      const recordedTableIds = new Set<string>();
      Object.values(entry.changes.updated).forEach(([before, after]) => {
        if (
          !isTableShape(before) ||
          !isTableShape(after) ||
          before.props.tableId !== after.props.tableId ||
          (before.x === after.x && before.y === after.y)
        ) {
          return;
        }

        const suppressedPosition = suppressedTablePositions.get(
          after.props.tableId
        );

        if (suppressedPosition) {
          suppressedTablePositions.delete(after.props.tableId);

          if (
            suppressedPosition.x === after.x &&
            suppressedPosition.y === after.y
          ) {
            return;
          }
        }

        changedTableIds.add(after.props.tableId);
        recordedTableIds.add(after.props.tableId);
      });
      return [...recordedTableIds];
    },
    suppressNext(tablePositions: readonly SqltoerdTableLayout[]) {
      tablePositions.forEach(({ tableId, x, y }) => {
        suppressedTablePositions.set(tableId, { x, y });
      });
    }
  };
}

type SqlErdTablePositionKeyUpEvent = Pick<
  KeyboardEvent,
  "ctrlKey" | "key" | "metaKey"
>;

export function shouldFlushSqlErdTablePositionChangesOnKeyUp(
  event: SqlErdTablePositionKeyUpEvent
) {
  if (
    event.key === "ArrowDown" ||
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight" ||
    event.key === "ArrowUp"
  ) {
    return true;
  }

  const key = event.key.toLowerCase();
  return (event.ctrlKey || event.metaKey) && (key === "y" || key === "z");
}

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
