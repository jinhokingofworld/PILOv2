import type { SqltoerdLayoutJsonV1 } from "@/features/sql-erd/types";

type JsonRecord = Record<string, unknown>;
type CollectionPatch = { deleteIds?: unknown; upsert?: unknown };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyCollection(
  current: JsonRecord[],
  patch: unknown,
  idField: "id" | "tableId"
) {
  if (!isRecord(patch)) return current;
  const collection = patch as CollectionPatch;
  const deleted = new Set(
    Array.isArray(collection.deleteIds)
      ? collection.deleteIds.filter((value): value is string => typeof value === "string")
      : []
  );
  const upserts = Array.isArray(collection.upsert)
    ? collection.upsert.filter(isRecord)
    : [];
  const byId = new Map<string, JsonRecord>();

  current.forEach((item) => {
    const id = item[idField];
    if (typeof id === "string" && !deleted.has(id)) byId.set(id, item);
  });
  upserts.forEach((item) => {
    const id = item[idField];
    if (typeof id === "string") byId.set(id, item);
  });
  return [...byId.values()];
}

export function applySqlErdOperationLayoutPatch(
  layoutJson: SqltoerdLayoutJsonV1,
  patch: Record<string, unknown>
): SqltoerdLayoutJsonV1 {
  const annotationsPatch = isRecord(patch.annotations) ? patch.annotations : null;
  const annotations = layoutJson.annotations;
  const nextAnnotations = annotationsPatch
    ? {
        ...(annotations ?? { version: 1 as const, links: [] }),
        links: applyCollection(annotations?.links ?? [], annotationsPatch.links, "id"),
        notes: applyCollection(annotations?.notes ?? [], annotationsPatch.notes, "id"),
        frames: applyCollection(annotations?.frames ?? [], annotationsPatch.frames, "id"),
        texts: applyCollection(annotations?.texts ?? [], annotationsPatch.texts, "id"),
        strokes: applyCollection(annotations?.strokes ?? [], annotationsPatch.strokes, "id")
      }
    : annotations;
  const viewportPatch = isRecord(patch.viewport) ? patch.viewport : null;
  const viewport =
    viewportPatch?.action === "delete"
      ? undefined
      : viewportPatch?.action === "set" && isRecord(viewportPatch.value)
        ? viewportPatch.value
        : layoutJson.viewport;

  return {
    ...layoutJson,
    tableLayouts: applyCollection(layoutJson.tableLayouts, patch.tableLayouts, "tableId"),
    ...(nextAnnotations ? { annotations: nextAnnotations } : {}),
    ...(viewport ? { viewport } : {})
  } as SqltoerdLayoutJsonV1;
}
