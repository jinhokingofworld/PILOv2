import { SqlErdJsonObject } from "./sql-erd.types";
import { validateSqlErdLayoutJson } from "./sql-erd.validation";

const DEFAULT_TABLE_WIDTH = 320;
const DEFAULT_TABLE_HEIGHT = 180;
const INITIAL_TABLE_X = 80;
const INITIAL_TABLE_Y = 80;
const GRID_COLUMN_GAP = 40;
const GRID_ROW_GAP = 100;
const APPENDED_TABLE_GAP = 144;
const PLACEMENT_ROW_STEP = DEFAULT_TABLE_HEIGHT + 72;

export interface SqlErdSourceRebaseSummary {
  createdTableLayoutIds: string[];
  removedAnnotationLinkIds: string[];
  removedTableLayoutIds: string[];
}

export interface SqlErdSourceRebaseResult {
  layoutJson: SqlErdJsonObject;
  summary: SqlErdSourceRebaseSummary;
}

interface TableLayout extends SqlErdJsonObject {
  tableId: string;
  x: number;
  y: number;
  width?: number;
}

interface Rectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * Rebase persisted layout state onto a source-published model. The caller has
 * already validated both JSON values; this helper preserves only references
 * that still exist in the new model and deterministically lays out new tables.
 */
export function rebaseSqlErdSourceLayout({
  currentLayout,
  nextModel
}: {
  currentLayout: SqlErdJsonObject;
  nextModel: SqlErdJsonObject;
}): SqlErdSourceRebaseResult {
  const modelMetadata = readModelMetadata(nextModel);
  const currentTableLayouts = readArray(currentLayout.tableLayouts)
    .filter(isJsonObject)
    .filter(hasTableLayoutFields);
  const retainedTableLayouts = currentTableLayouts.filter((layout) =>
    modelMetadata.tableIds.has(layout.tableId)
  );
  const retainedTableIds = new Set(retainedTableLayouts.map((layout) => layout.tableId));
  const createdTableLayoutIds = [...modelMetadata.tableIds]
    .filter((tableId) => !retainedTableIds.has(tableId))
    .sort();
  const collisionSet = [...retainedTableLayouts];
  const createdTableLayouts = createdTableLayoutIds.map((tableId, index) => {
    const layout = createTableLayout(tableId, index, collisionSet);
    collisionSet.push(layout);
    return layout;
  });

  const removedTableLayoutIds = currentTableLayouts
    .filter((layout) => !modelMetadata.tableIds.has(layout.tableId))
    .map((layout) => layout.tableId);
  const { annotations, removedAnnotationLinkIds } = rebaseAnnotations(
    currentLayout.annotations,
    modelMetadata
  );
  const layoutJson: SqlErdJsonObject = {
    version: 1,
    tableLayouts: [...retainedTableLayouts, ...createdTableLayouts]
  };

  if (isJsonObject(currentLayout.viewport)) {
    layoutJson.viewport = { ...currentLayout.viewport };
  }
  if (annotations) {
    layoutJson.annotations = annotations;
  }

  validateSqlErdLayoutJson(layoutJson, nextModel);

  return {
    layoutJson,
    summary: {
      createdTableLayoutIds,
      removedAnnotationLinkIds,
      removedTableLayoutIds
    }
  };
}

function createTableLayout(
  tableId: string,
  newTableIndex: number,
  collisionSet: readonly TableLayout[]
): TableLayout {
  if (collisionSet.length === 0) {
    return {
      tableId,
      x: INITIAL_TABLE_X + (newTableIndex % 3) * (DEFAULT_TABLE_WIDTH + GRID_COLUMN_GAP),
      y:
        INITIAL_TABLE_Y +
        Math.floor(newTableIndex / 3) * (DEFAULT_TABLE_HEIGHT + GRID_ROW_GAP)
    };
  }

  const rightmostBoundary = Math.max(
    ...collisionSet.map((layout) => layout.x + (layout.width ?? DEFAULT_TABLE_WIDTH))
  );
  const topmostY = Math.min(...collisionSet.map((layout) => layout.y));
  const x = rightmostBoundary + APPENDED_TABLE_GAP;
  let y = Math.max(INITIAL_TABLE_Y, topmostY);

  while (intersectsExistingLayout({ x, y, width: DEFAULT_TABLE_WIDTH, height: DEFAULT_TABLE_HEIGHT }, collisionSet)) {
    y += PLACEMENT_ROW_STEP;
  }

  return { tableId, x, y };
}

function intersectsExistingLayout(candidate: Rectangle, layouts: readonly TableLayout[]): boolean {
  return layouts.some((layout) => {
    const existing: Rectangle = {
      x: layout.x,
      y: layout.y,
      width: layout.width ?? DEFAULT_TABLE_WIDTH,
      height: DEFAULT_TABLE_HEIGHT
    };
    return (
      candidate.x < existing.x + existing.width &&
      candidate.x + candidate.width > existing.x &&
      candidate.y < existing.y + existing.height &&
      candidate.y + candidate.height > existing.y
    );
  });
}

function rebaseAnnotations(
  value: unknown,
  metadata: { tableColumnIds: Map<string, Set<string>>; tableIds: Set<string> }
): { annotations: SqlErdJsonObject | undefined; removedAnnotationLinkIds: string[] } {
  if (!isJsonObject(value)) {
    return { annotations: undefined, removedAnnotationLinkIds: [] };
  }

  const links = readArray(value.links).filter(isJsonObject);
  const retainedLinks = links.filter((link) => isValidAnnotationLink(link, metadata));
  const removedAnnotationLinkIds = links
    .filter((link) => !isValidAnnotationLink(link, metadata))
    .flatMap((link) => (typeof link.id === "string" ? [link.id] : []));

  return {
    annotations: {
      ...value,
      links: retainedLinks.map((link) => ({ ...link })),
      ...(Array.isArray(value.notes) ? { notes: value.notes.map(copyJsonValue) } : {}),
      ...(Array.isArray(value.frames) ? { frames: value.frames.map(copyJsonValue) } : {}),
      ...(Array.isArray(value.texts) ? { texts: value.texts.map(copyJsonValue) } : {}),
      ...(Array.isArray(value.strokes) ? { strokes: value.strokes.map(copyJsonValue) } : {})
    },
    removedAnnotationLinkIds
  };
}

function isValidAnnotationLink(
  link: SqlErdJsonObject,
  metadata: { tableColumnIds: Map<string, Set<string>>; tableIds: Set<string> }
): boolean {
  if (typeof link.fromTableId !== "string" || typeof link.toTableId !== "string") {
    return false;
  }
  if (!metadata.tableIds.has(link.fromTableId) || !metadata.tableIds.has(link.toTableId)) {
    return false;
  }
  if (link.kind === "table_link") {
    return true;
  }
  if (link.kind !== "column_link") {
    return false;
  }
  return (
    typeof link.fromColumnId === "string" &&
    typeof link.toColumnId === "string" &&
    metadata.tableColumnIds.get(link.fromTableId)?.has(link.fromColumnId) === true &&
    metadata.tableColumnIds.get(link.toTableId)?.has(link.toColumnId) === true
  );
}

function readModelMetadata(modelJson: SqlErdJsonObject): {
  tableColumnIds: Map<string, Set<string>>;
  tableIds: Set<string>;
} {
  const schema = isJsonObject(modelJson.schema) ? modelJson.schema : {};
  const tableColumnIds = new Map<string, Set<string>>();

  readArray(schema.tables).filter(isJsonObject).forEach((table) => {
    if (typeof table.id !== "string") return;
    const columnIds = new Set(
      readArray(table.columns)
        .filter(isJsonObject)
        .flatMap((column) => (typeof column.id === "string" ? [column.id] : []))
    );
    tableColumnIds.set(table.id, columnIds);
  });

  return { tableColumnIds, tableIds: new Set(tableColumnIds.keys()) };
}

function hasTableLayoutFields(value: SqlErdJsonObject): value is TableLayout {
  return (
    typeof value.tableId === "string" &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    (value.width === undefined || typeof value.width === "number")
  );
}

function isJsonObject(value: unknown): value is SqlErdJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function copyJsonValue<T>(value: T): T {
  return structuredClone(value);
}
