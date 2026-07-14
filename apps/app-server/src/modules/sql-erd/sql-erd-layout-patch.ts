import { SqlErdJsonObject, SqlErdLayoutPatch, SqlErdLayoutPatchCollection } from "./sql-erd.types";

const ANNOTATION_COLLECTIONS = ["links", "notes", "frames", "texts", "strokes"] as const;

export function applySqlErdLayoutPatch(
  currentLayout: SqlErdJsonObject,
  patch: SqlErdLayoutPatch
): SqlErdJsonObject {
  const nextLayout = cloneJsonObject(currentLayout);

  if (patch.tableLayouts) {
    const tableLayouts = Array.isArray(nextLayout.tableLayouts)
      ? nextLayout.tableLayouts
      : [];
    nextLayout.tableLayouts = applyCollectionPatch(
      tableLayouts,
      patch.tableLayouts,
      "tableId"
    );
  }

  if (patch.viewport) {
    if (patch.viewport.action === "delete") {
      delete nextLayout.viewport;
    } else {
      nextLayout.viewport = patch.viewport.value;
    }
  }

  if (patch.annotations) {
    const annotations = isJsonObject(nextLayout.annotations)
      ? cloneJsonObject(nextLayout.annotations)
      : { version: 1, links: [] };

    for (const collectionName of ANNOTATION_COLLECTIONS) {
      const collectionPatch = patch.annotations[collectionName];
      if (!collectionPatch) continue;

      const currentCollection = Array.isArray(annotations[collectionName])
        ? annotations[collectionName]
        : [];
      annotations[collectionName] = applyCollectionPatch(
        currentCollection,
        collectionPatch,
        "id"
      );
    }

    nextLayout.annotations = annotations;
  }

  return nextLayout;
}

function applyCollectionPatch(
  current: unknown[],
  patch: SqlErdLayoutPatchCollection,
  idField: "id" | "tableId"
): SqlErdJsonObject[] {
  const deleteIds = new Set(patch.deleteIds ?? []);
  const upserts = new Map(
    (patch.upsert ?? []).map((item) => [String(item[idField]), cloneJsonObject(item)])
  );
  const next = current
    .filter(
      (item): item is SqlErdJsonObject =>
        isJsonObject(item) && !deleteIds.has(String(item[idField]))
    )
    .map((item) => {
      const id = String(item[idField]);
      const replacement = upserts.get(id);
      if (replacement) {
        upserts.delete(id);
        return replacement;
      }
      return cloneJsonObject(item);
    });

  return [...next, ...upserts.values()];
}

function cloneJsonObject(value: SqlErdJsonObject): SqlErdJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqlErdJsonObject;
}

function isJsonObject(value: unknown): value is SqlErdJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
