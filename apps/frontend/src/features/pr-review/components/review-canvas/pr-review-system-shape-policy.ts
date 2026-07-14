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
