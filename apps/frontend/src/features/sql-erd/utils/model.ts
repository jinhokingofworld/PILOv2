import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqltoerdAnnotationLink,
  SqltoerdAnnotationsV1,
  SqltoerdCanvasFrame,
  SqltoerdCanvasNote,
  SqltoerdLayoutPatch,
  SqltoerdColumnAnnotationLink,
  SqltoerdLayoutJsonV1,
  SqltoerdModelCounts,
  SqltoerdModelJsonV1,
  SqltoerdTableAnnotationLink,
  SqltoerdTableLayout
} from "@/features/sql-erd/types";

export type SqltoerdRelationEndpoint = {
  table: ErdTable;
  columns: ErdColumn[];
};

export type SqltoerdRelationEndpoints = {
  from: SqltoerdRelationEndpoint;
  to: SqltoerdRelationEndpoint;
};

export type SqlErdRelationCardinality =
  | "one"
  | "zero_or_one"
  | "zero_or_many";

export type SqlErdRelationCardinalityEndpoints = {
  from: SqlErdRelationCardinality;
  to: SqlErdRelationCardinality;
};

export type SqltoerdModelIndex = {
  tablesById: Map<string, ErdTable>;
  columnsByTableId: Map<string, Map<string, ErdColumn>>;
  relationsById: Map<string, ErdRelation>;
  relationsByTableId: Map<string, ErdRelation[]>;
};

export type SqltoerdTablePosition = Pick<
  SqltoerdTableLayout,
  "tableId" | "x" | "y"
>;

export type SqltoerdColumnAnnotationAddFailureReason =
  | "annotation_exists"
  | "annotation_limit"
  | "foreign_key_exists"
  | "invalid_endpoint"
  | "same_endpoint";

export type SqltoerdColumnAnnotationAddResult =
  | {
      ok: true;
      layoutJson: SqltoerdLayoutJsonV1;
    }
  | {
      ok: false;
      reason: SqltoerdColumnAnnotationAddFailureReason;
    };

export type SqltoerdTableAnnotationAddFailureReason = Exclude<
  SqltoerdColumnAnnotationAddFailureReason,
  "foreign_key_exists"
>;

export type SqltoerdTableAnnotationAddResult =
  | {
      ok: true;
      layoutJson: SqltoerdLayoutJsonV1;
    }
  | {
      ok: false;
      reason: SqltoerdTableAnnotationAddFailureReason;
    };

export function getSqltoerdModelCounts(
  modelJson: SqltoerdModelJsonV1
): SqltoerdModelCounts {
  return {
    tableCount: modelJson.schema.tables.length,
    columnCount: modelJson.schema.tables.reduce(
      (totalColumns, table) => totalColumns + table.columns.length,
      0
    ),
    relationCount: modelJson.schema.relations.length
  };
}

export function createSqltoerdLayoutForModel(
  modelJson: SqltoerdModelJsonV1,
  previousLayoutJson?: SqltoerdLayoutJsonV1
): SqltoerdLayoutJsonV1 {
  const previousLayoutsByTableId = new Map(
    previousLayoutJson?.tableLayouts.map((tableLayout) => [
      tableLayout.tableId,
      tableLayout
    ]) ?? []
  );
  const annotations = filterSqltoerdAnnotationsForModel(
    modelJson,
    previousLayoutJson?.annotations
  );

  return {
    version: 1 as SqltoerdLayoutJsonV1["version"],
    tableLayouts: modelJson.schema.tables.map((table, index) => {
      const previousLayout = previousLayoutsByTableId.get(table.id);

      if (previousLayout) {
        return previousLayout;
      }

      return {
        tableId: table.id,
        x: 80 + (index % 3) * 360,
        y: 80 + Math.floor(index / 3) * 280
      };
    }),
    ...(annotations ? { annotations } : {})
  };
}

export function updateSqltoerdLayoutWithTablePositions(
  modelJson: SqltoerdModelJsonV1,
  previousLayoutJson: SqltoerdLayoutJsonV1,
  tablePositions: SqltoerdTablePosition[]
): SqltoerdLayoutJsonV1 {
  const tablePositionsById = new Map(
    tablePositions.map((tablePosition) => [
      tablePosition.tableId,
      tablePosition
    ])
  );
  const baseLayoutJson = createSqltoerdLayoutForModel(
    modelJson,
    previousLayoutJson
  );

  return {
    ...baseLayoutJson,
    tableLayouts: baseLayoutJson.tableLayouts.map((tableLayout) => {
      const tablePosition = tablePositionsById.get(tableLayout.tableId);

      if (!tablePosition) {
        return tableLayout;
      }

      return {
        ...tableLayout,
        x: tablePosition.x,
        y: tablePosition.y
      };
    }),
    ...(previousLayoutJson.viewport
      ? { viewport: previousLayoutJson.viewport }
      : {}),
    ...(previousLayoutJson.annotations
      ? { annotations: previousLayoutJson.annotations }
      : {})
  };
}

export function applySqltoerdLayoutPatch(
  currentLayoutJson: SqltoerdLayoutJsonV1,
  patch: SqltoerdLayoutPatch
): SqltoerdLayoutJsonV1 {
  const notesById = patch.notesById ?? {};
  const framesById = patch.framesById ?? {};
  const linksById = patch.linksById ?? {};
  const deletedLinkIds = new Set(patch.deleteLinkIds ?? []);
  const deletedNoteIds = new Set(patch.deleteNoteIds ?? []);
  const deletedFrameIds = new Set(patch.deleteFrameIds ?? []);
  const positionsByTableId = new Map(
    (patch.tablePositions ?? []).map((position) => [position.tableId, position])
  );
  const hasAnnotationPatch =
    Object.keys(linksById).length > 0 ||
    deletedLinkIds.size > 0 ||
    (patch.linksToAdd?.length ?? 0) > 0 ||
    Object.keys(notesById).length > 0 ||
    Object.keys(framesById).length > 0 ||
    deletedNoteIds.size > 0 ||
    deletedFrameIds.size > 0 ||
    (patch.notesToAdd?.length ?? 0) > 0 ||
    (patch.framesToAdd?.length ?? 0) > 0;
  const annotations = currentLayoutJson.annotations ??
    (hasAnnotationPatch ? { version: 1, links: [] } : null);

  return {
    ...currentLayoutJson,
    tableLayouts: currentLayoutJson.tableLayouts.map((layout) => {
      const position = positionsByTableId.get(layout.tableId);
      return position ? { ...layout, ...position } : layout;
    }),
    ...(annotations ? { annotations: {
            ...annotations,
            links: annotations.links
              .filter((link) => !deletedLinkIds.has(link.id))
              .map((link) => ({ ...link, ...linksById[link.id] }))
              .concat(patch.linksToAdd ?? []),
            notes: (annotations.notes ?? [])
              .filter((note) => !deletedNoteIds.has(note.id))
              .map((note) => ({ ...note, ...notesById[note.id] }))
              .concat(patch.notesToAdd ?? []),
            frames: (annotations.frames ?? [])
              .filter((frame) => !deletedFrameIds.has(frame.id))
              .map((frame) => ({ ...frame, ...framesById[frame.id] }))
              .concat(patch.framesToAdd ?? [])
          } } : {})
  };
}

export function areSqltoerdLayoutsEqual(
  leftLayoutJson: SqltoerdLayoutJsonV1,
  rightLayoutJson: SqltoerdLayoutJsonV1
) {
  if (
    leftLayoutJson.version !== rightLayoutJson.version ||
    leftLayoutJson.tableLayouts.length !== rightLayoutJson.tableLayouts.length
  ) {
    return false;
  }

  for (let index = 0; index < leftLayoutJson.tableLayouts.length; index += 1) {
    if (
      !areSqltoerdTableLayoutsEqual(
        leftLayoutJson.tableLayouts[index],
        rightLayoutJson.tableLayouts[index]
      )
    ) {
      return false;
    }
  }

  return areSqltoerdViewportsEqual(
    leftLayoutJson.viewport,
    rightLayoutJson.viewport
  ) && areSqltoerdAnnotationsEqual(
    leftLayoutJson.annotations,
    rightLayoutJson.annotations
  );
}

export function addSqltoerdColumnAnnotation(
  modelJson: SqltoerdModelJsonV1,
  layoutJson: SqltoerdLayoutJsonV1,
  annotation: SqltoerdColumnAnnotationLink
): SqltoerdColumnAnnotationAddResult {
  if ((layoutJson.annotations?.links.length ?? 0) >= 300) {
    return { ok: false, reason: "annotation_limit" };
  }

  const modelIndex = createSqltoerdModelIndex(modelJson);
  const fromEndpoint = getSqltoerdColumnAnnotationEndpoint(
    annotation.fromTableId,
    annotation.fromColumnId
  );
  const toEndpoint = getSqltoerdColumnAnnotationEndpoint(
    annotation.toTableId,
    annotation.toColumnId
  );

  if (
    !modelIndex.columnsByTableId
      .get(annotation.fromTableId)
      ?.has(annotation.fromColumnId) ||
    !modelIndex.columnsByTableId
      .get(annotation.toTableId)
      ?.has(annotation.toColumnId)
  ) {
    return { ok: false, reason: "invalid_endpoint" };
  }

  if (fromEndpoint === toEndpoint) {
    return { ok: false, reason: "same_endpoint" };
  }

  const annotationKey = getSqltoerdUndirectedEndpointKey(
    fromEndpoint,
    toEndpoint
  );

  if (hasSqltoerdColumnAnnotationForeignKeyConflict(modelJson, annotation)) {
    return { ok: false, reason: "foreign_key_exists" };
  }

  if (
    layoutJson.annotations?.links.some(
      (link) =>
        link.kind === "column_link" &&
        getSqltoerdUndirectedEndpointKey(
          getSqltoerdColumnAnnotationEndpoint(
            link.fromTableId,
            link.fromColumnId
          ),
          getSqltoerdColumnAnnotationEndpoint(link.toTableId, link.toColumnId)
        ) === annotationKey
    )
  ) {
    return { ok: false, reason: "annotation_exists" };
  }

  return {
    ok: true,
    layoutJson: {
      ...layoutJson,
      annotations: {
        version: 1,
        links: [...(layoutJson.annotations?.links ?? []), annotation]
      }
    }
  };
}

export function addSqltoerdTableAnnotation(
  modelJson: SqltoerdModelJsonV1,
  layoutJson: SqltoerdLayoutJsonV1,
  annotation: SqltoerdTableAnnotationLink
): SqltoerdTableAnnotationAddResult {
  if ((layoutJson.annotations?.links.length ?? 0) >= 300) {
    return { ok: false, reason: "annotation_limit" };
  }

  const modelIndex = createSqltoerdModelIndex(modelJson);

  if (
    !modelIndex.tablesById.has(annotation.fromTableId) ||
    !modelIndex.tablesById.has(annotation.toTableId)
  ) {
    return { ok: false, reason: "invalid_endpoint" };
  }

  if (annotation.fromTableId === annotation.toTableId) {
    return { ok: false, reason: "same_endpoint" };
  }

  const annotationKey = getSqltoerdUndirectedEndpointKey(
    annotation.fromTableId,
    annotation.toTableId
  );

  if (
    layoutJson.annotations?.links.some(
      (link) =>
        link.kind === "table_link" &&
        getSqltoerdUndirectedEndpointKey(
          link.fromTableId,
          link.toTableId
        ) === annotationKey
    )
  ) {
    return { ok: false, reason: "annotation_exists" };
  }

  return {
    ok: true,
    layoutJson: {
      ...layoutJson,
      annotations: {
        version: 1,
        links: [...(layoutJson.annotations?.links ?? []), annotation]
      }
    }
  };
}

export function getSqltoerdRenderableAnnotations(
  modelJson: SqltoerdModelJsonV1,
  annotations: SqltoerdAnnotationsV1 | undefined
): SqltoerdAnnotationsV1 | undefined {
  if (!annotations) {
    return undefined;
  }

  return {
    ...annotations,
    links: annotations.links.filter(
      (annotation) =>
        annotation.kind !== "column_link" ||
        !hasSqltoerdColumnAnnotationForeignKeyConflict(modelJson, annotation)
    )
  };
}

function hasSqltoerdColumnAnnotationForeignKeyConflict(
  modelJson: SqltoerdModelJsonV1,
  annotation: SqltoerdColumnAnnotationLink
) {
  const annotationKey = getSqltoerdUndirectedEndpointKey(
    getSqltoerdColumnAnnotationEndpoint(
      annotation.fromTableId,
      annotation.fromColumnId
    ),
    getSqltoerdColumnAnnotationEndpoint(
      annotation.toTableId,
      annotation.toColumnId
    )
  );

  return modelJson.schema.relations.some((relation) =>
    relation.fromColumnIds.some((fromColumnId, index) => {
      const toColumnId = relation.toColumnIds[index];

      return (
        typeof toColumnId === "string" &&
        getSqltoerdUndirectedEndpointKey(
          getSqltoerdColumnAnnotationEndpoint(
            relation.fromTableId,
            fromColumnId
          ),
          getSqltoerdColumnAnnotationEndpoint(relation.toTableId, toColumnId)
        ) === annotationKey
      );
    })
  );
}

export function updateSqltoerdAnnotationLabel(
  layoutJson: SqltoerdLayoutJsonV1,
  annotationId: string,
  label: string
): SqltoerdLayoutJsonV1 {
  if (!layoutJson.annotations) {
    return layoutJson;
  }

  return {
    ...layoutJson,
    annotations: {
      ...layoutJson.annotations,
      links: layoutJson.annotations.links.map((annotation) =>
        annotation.id === annotationId ? { ...annotation, label } : annotation
      )
    }
  };
}

export function removeSqltoerdAnnotation(
  layoutJson: SqltoerdLayoutJsonV1,
  annotationId: string
): SqltoerdLayoutJsonV1 {
  if (!layoutJson.annotations) {
    return layoutJson;
  }

  return {
    ...layoutJson,
    annotations: {
      ...layoutJson.annotations,
      links: layoutJson.annotations.links.filter(
        (annotation) => annotation.id !== annotationId
      )
    }
  };
}

function getSqltoerdColumnAnnotationEndpoint(
  tableId: string,
  columnId: string
) {
  return JSON.stringify([tableId, columnId]);
}

function getSqltoerdUndirectedEndpointKey(
  leftEndpoint: string,
  rightEndpoint: string
) {
  return leftEndpoint < rightEndpoint
    ? `${leftEndpoint}:${rightEndpoint}`
    : `${rightEndpoint}:${leftEndpoint}`;
}

export function createSqltoerdModelIndex(
  modelJson: SqltoerdModelJsonV1
): SqltoerdModelIndex {
  const tablesById = new Map<string, ErdTable>();
  const columnsByTableId = new Map<string, Map<string, ErdColumn>>();
  const relationsById = new Map<string, ErdRelation>();
  const relationsByTableId = new Map<string, ErdRelation[]>();

  for (const table of modelJson.schema.tables) {
    tablesById.set(table.id, table);
    columnsByTableId.set(table.id, createColumnsById(table));
    relationsByTableId.set(table.id, []);
  }

  for (const relation of modelJson.schema.relations) {
    relationsById.set(relation.id, relation);
    appendRelation(relationsByTableId, relation.fromTableId, relation);

    if (relation.fromTableId === relation.toTableId) {
      continue;
    }

    appendRelation(relationsByTableId, relation.toTableId, relation);
  }

  return {
    tablesById,
    columnsByTableId,
    relationsById,
    relationsByTableId
  };
}

export function findErdTable(
  modelJson: SqltoerdModelJsonV1,
  tableId: string
) {
  return modelJson.schema.tables.find((table) => table.id === tableId) ?? null;
}

export function findErdColumn(table: ErdTable, columnId: string) {
  return table.columns.find((column) => column.id === columnId) ?? null;
}

export function getTableLayout(
  layoutJson: SqltoerdLayoutJsonV1,
  tableId: string
): SqltoerdTableLayout | null {
  return (
    layoutJson.tableLayouts.find((tableLayout) => tableLayout.tableId === tableId) ??
    null
  );
}

export function getTableDisplayName(table: ErdTable) {
  return table.schemaName ? `${table.schemaName}.${table.name}` : table.name;
}

export function getRelationEndpoints(
  relation: ErdRelation,
  modelIndex: SqltoerdModelIndex
): SqltoerdRelationEndpoints | null {
  const fromTable = modelIndex.tablesById.get(relation.fromTableId);
  const toTable = modelIndex.tablesById.get(relation.toTableId);

  if (!fromTable || !toTable) {
    return null;
  }

  const fromColumns: ErdColumn[] = [];
  const toColumns: ErdColumn[] = [];
  const fromColumnsById = modelIndex.columnsByTableId.get(fromTable.id);
  const toColumnsById = modelIndex.columnsByTableId.get(toTable.id);

  if (!fromColumnsById || !toColumnsById) {
    return null;
  }

  for (const columnId of relation.fromColumnIds) {
    const column = fromColumnsById.get(columnId);

    if (!column) {
      return null;
    }

    fromColumns.push(column);
  }

  for (const columnId of relation.toColumnIds) {
    const column = toColumnsById.get(columnId);

    if (!column) {
      return null;
    }

    toColumns.push(column);
  }

  return {
    from: {
      table: fromTable,
      columns: fromColumns
    },
    to: {
      table: toTable,
      columns: toColumns
    }
  };
}

export function inferSqlErdRelationCardinality(
  relation: ErdRelation,
  modelIndex: SqltoerdModelIndex
): SqlErdRelationCardinalityEndpoints | null {
  if (
    relation.fromColumnIds.length !== 1 ||
    relation.toColumnIds.length !== 1
  ) {
    return null;
  }

  const endpoints = getRelationEndpoints(relation, modelIndex);

  if (
    !endpoints ||
    endpoints.from.columns.length !== 1 ||
    endpoints.to.columns.length !== 1
  ) {
    return null;
  }

  const fromColumn = endpoints.from.columns[0];
  const isFromColumnUnique =
    fromColumn.unique ||
    endpoints.from.table.constraints.some(
      (constraint) =>
        (constraint.kind === "primary_key" || constraint.kind === "unique") &&
        constraint.columnIds.length === 1 &&
        constraint.columnIds[0] === fromColumn.id
    );

  return {
    from: isFromColumnUnique ? "zero_or_one" : "zero_or_many",
    to: fromColumn.nullable ? "zero_or_one" : "one"
  };
}

function areOptionalNumbersEqual(left?: number, right?: number) {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return Math.abs(left - right) < 0.01;
}

function areSqltoerdTableLayoutsEqual(
  leftTableLayout: SqltoerdTableLayout,
  rightTableLayout: SqltoerdTableLayout
) {
  return (
    leftTableLayout.tableId === rightTableLayout.tableId &&
    Math.abs(leftTableLayout.x - rightTableLayout.x) < 0.01 &&
    Math.abs(leftTableLayout.y - rightTableLayout.y) < 0.01 &&
    areOptionalNumbersEqual(leftTableLayout.width, rightTableLayout.width)
  );
}

function areSqltoerdViewportsEqual(
  leftViewport: SqltoerdLayoutJsonV1["viewport"],
  rightViewport: SqltoerdLayoutJsonV1["viewport"]
) {
  if (!leftViewport || !rightViewport) {
    return leftViewport === rightViewport;
  }

  return (
    Math.abs(leftViewport.x - rightViewport.x) < 0.01 &&
    Math.abs(leftViewport.y - rightViewport.y) < 0.01 &&
    Math.abs(leftViewport.zoom - rightViewport.zoom) < 0.01
  );
}

function filterSqltoerdAnnotationsForModel(
  modelJson: SqltoerdModelJsonV1,
  annotations: SqltoerdAnnotationsV1 | undefined
): SqltoerdAnnotationsV1 | undefined {
  if (!annotations) {
    return undefined;
  }

  const modelIndex = createSqltoerdModelIndex(modelJson);
  return {
    ...annotations,
    links: annotations.links.filter((annotation) =>
      isSqltoerdAnnotationEndpointPresent(annotation, modelIndex)
    )
  };
}

function isSqltoerdAnnotationEndpointPresent(
  annotation: SqltoerdAnnotationLink,
  modelIndex: SqltoerdModelIndex
) {
  if (
    !modelIndex.tablesById.has(annotation.fromTableId) ||
    !modelIndex.tablesById.has(annotation.toTableId)
  ) {
    return false;
  }

  if (annotation.kind === "table_link") {
    return true;
  }

  return (
    modelIndex.columnsByTableId
      .get(annotation.fromTableId)
      ?.has(annotation.fromColumnId) === true &&
    modelIndex.columnsByTableId
      .get(annotation.toTableId)
      ?.has(annotation.toColumnId) === true
  );
}

function areSqltoerdAnnotationsEqual(
  leftAnnotations: SqltoerdAnnotationsV1 | undefined,
  rightAnnotations: SqltoerdAnnotationsV1 | undefined
) {
  const leftLinks = leftAnnotations?.links ?? [];
  const rightLinks = rightAnnotations?.links ?? [];
  const leftNotes = leftAnnotations?.notes ?? [];
  const rightNotes = rightAnnotations?.notes ?? [];
  const leftFrames = leftAnnotations?.frames ?? [];
  const rightFrames = rightAnnotations?.frames ?? [];

  if (
    leftLinks.length !== rightLinks.length ||
    leftNotes.length !== rightNotes.length ||
    leftFrames.length !== rightFrames.length
  ) {
    return false;
  }

  return (
    leftLinks.every((leftLink, index) =>
      areSqltoerdAnnotationLinksEqual(leftLink, rightLinks[index])
    ) &&
    leftNotes.every((leftNote, index) =>
      areSqltoerdCanvasNotesEqual(leftNote, rightNotes[index])
    ) &&
    leftFrames.every((leftFrame, index) =>
      areSqltoerdCanvasFramesEqual(leftFrame, rightFrames[index])
    )
  );
}

function areSqltoerdCanvasNotesEqual(
  leftNote: SqltoerdCanvasNote,
  rightNote: SqltoerdCanvasNote | undefined
) {
  return (
    rightNote !== undefined &&
    leftNote.id === rightNote.id &&
    leftNote.x === rightNote.x &&
    leftNote.y === rightNote.y &&
    leftNote.width === rightNote.width &&
    leftNote.height === rightNote.height &&
    leftNote.text === rightNote.text
  );
}

function areSqltoerdCanvasFramesEqual(
  leftFrame: SqltoerdCanvasFrame,
  rightFrame: SqltoerdCanvasFrame | undefined
) {
  return (
    rightFrame !== undefined &&
    leftFrame.id === rightFrame.id &&
    leftFrame.x === rightFrame.x &&
    leftFrame.y === rightFrame.y &&
    leftFrame.width === rightFrame.width &&
    leftFrame.height === rightFrame.height &&
    leftFrame.title === rightFrame.title &&
    leftFrame.color === rightFrame.color &&
    leftFrame.isLocked === rightFrame.isLocked
  );
}

function areSqltoerdAnnotationLinksEqual(
  leftLink: SqltoerdAnnotationLink,
  rightLink: SqltoerdAnnotationLink | undefined
) {
  if (
    !rightLink ||
    leftLink.id !== rightLink.id ||
    leftLink.kind !== rightLink.kind ||
    leftLink.fromTableId !== rightLink.fromTableId ||
    leftLink.toTableId !== rightLink.toTableId ||
    leftLink.label !== rightLink.label
  ) {
    return false;
  }

  if (leftLink.kind === "table_link" || rightLink.kind === "table_link") {
    return leftLink.kind === rightLink.kind;
  }

  return (
    leftLink.fromColumnId === rightLink.fromColumnId &&
    leftLink.toColumnId === rightLink.toColumnId
  );
}

function createColumnsById(table: ErdTable) {
  const columnsById = new Map<string, ErdColumn>();

  for (const column of table.columns) {
    columnsById.set(column.id, column);
  }

  return columnsById;
}

function appendRelation(
  relationsByTableId: Map<string, ErdRelation[]>,
  tableId: string,
  relation: ErdRelation
) {
  const relations = relationsByTableId.get(tableId);

  if (relations) {
    relations.push(relation);
    return;
  }

  relationsByTableId.set(tableId, [relation]);
}
