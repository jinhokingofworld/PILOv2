import type {
  SqltoerdLayoutJsonV1,
  SqltoerdLayoutPatch
} from "@/features/sql-erd/types";

type CollectionPatch = { deleteIds?: string[]; upsert?: unknown[] };

function collectionPatch(
  deleteIds: readonly string[] | undefined,
  idsToUpsert: string[] | undefined,
  values: { id: string }[] | undefined
): CollectionPatch | undefined {
  const upsert = idsToUpsert?.flatMap((id) => {
    const value = values?.find((entry) => entry.id === id);
    return value ? [value] : [];
  });
  if (!(deleteIds?.length ?? 0) && !(upsert?.length ?? 0)) return undefined;
  return { ...(deleteIds?.length ? { deleteIds: [...deleteIds] } : {}), ...(upsert?.length ? { upsert } : {}) };
}

export function createSqlErdOperationLayoutPatch(
  patch: SqltoerdLayoutPatch,
  nextLayout: SqltoerdLayoutJsonV1
): Record<string, unknown> {
  const annotations = nextLayout.annotations;
  const annotationPatch = {
    frames: collectionPatch(
      patch.deleteFrameIds,
      [...Object.keys(patch.framesById ?? {}), ...(patch.framesToAdd ?? []).map((entry) => entry.id)],
      annotations?.frames
    ),
    links: collectionPatch(
      patch.deleteLinkIds,
      [...Object.keys(patch.linksById ?? {}), ...(patch.linksToAdd ?? []).map((entry) => entry.id)],
      annotations?.links
    ),
    notes: collectionPatch(
      patch.deleteNoteIds,
      [...Object.keys(patch.notesById ?? {}), ...(patch.notesToAdd ?? []).map((entry) => entry.id)],
      annotations?.notes
    ),
    strokes: collectionPatch(
      patch.deleteStrokeIds,
      (patch.strokesToAdd ?? []).map((entry) => entry.id),
      annotations?.strokes
    ),
    texts: collectionPatch(
      patch.deleteTextIds,
      [...Object.keys(patch.textsById ?? {}), ...(patch.textsToAdd ?? []).map((entry) => entry.id)],
      annotations?.texts
    )
  };
  const definedAnnotations = Object.fromEntries(
    Object.entries(annotationPatch).filter(([, value]) => value !== undefined)
  );
  const tableLayouts = patch.tablePositions?.length
    ? { upsert: patch.tablePositions }
    : undefined;

  return {
    ...(tableLayouts ? { tableLayouts } : {}),
    ...(Object.keys(definedAnnotations).length ? { annotations: definedAnnotations } : {})
  };
}
