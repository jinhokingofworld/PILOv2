export function shouldRemoveCreatedPrReviewSystemShape({
  hydrating,
  internalShapeUpdate,
  isSystemShape,
  source
}: {
  hydrating: boolean;
  internalShapeUpdate: boolean;
  isSystemShape: boolean;
  source: "remote" | "user";
}) {
  return (
    source === "user" &&
    isSystemShape &&
    !hydrating &&
    !internalShapeUpdate
  );
}

export function preservePrReviewFlowLabelTranslation<
  T extends { x: number; y: number }
>(previous: T, next: T): T {
  return {
    ...previous,
    x: next.x,
    y: next.y
  };
}
