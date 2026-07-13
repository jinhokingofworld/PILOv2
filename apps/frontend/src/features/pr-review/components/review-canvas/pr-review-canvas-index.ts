export type PrReviewCanvasIndexDependencies = {
  createIndexes: (count: number) => string[];
  isValidIndex: (index: string) => boolean;
};

export function resolvePrReviewCanvasShapeIndexes(
  rawIndexes: unknown[],
  dependencies: PrReviewCanvasIndexDependencies
): string[] {
  const indexes = rawIndexes.filter(
    (index): index is string => typeof index === "string"
  );
  const canPreserve =
    indexes.length === rawIndexes.length &&
    indexes.every(dependencies.isValidIndex) &&
    new Set(indexes).size === indexes.length;

  if (canPreserve) {
    return indexes;
  }

  const repaired = dependencies.createIndexes(rawIndexes.length);
  if (
    repaired.length !== rawIndexes.length ||
    !repaired.every(dependencies.isValidIndex) ||
    new Set(repaired).size !== repaired.length
  ) {
    throw new Error("Failed to create valid PR Review Canvas shape indexes");
  }

  return repaired;
}
