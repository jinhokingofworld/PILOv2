import type {
  PrReviewCanvas,
  PrReviewDecisionUpdatedEvent,
  PrReviewSummary
} from "@/features/pr-review/types";

export function applyDecisionUpdateToCanvas(
  canvas: PrReviewCanvas,
  update: PrReviewDecisionUpdatedEvent
): PrReviewCanvas {
  if (canvas.reviewSessionId !== update.reviewSessionId) {
    return canvas;
  }

  let changed = false;
  const flows = canvas.flows.map(flow => ({
    ...flow,
    files: flow.files.map(file => {
      if (file.reviewFileId !== update.reviewFileId) {
        return file;
      }

      changed = true;
      return {
        ...file,
        currentStatus: update.currentStatus,
        fileNodeData: {
          ...file.fileNodeData,
          reviewStatus: update.currentStatus
        }
      };
    })
  }));

  if (
    !changed &&
    canvas.reviewedCount === update.reviewedCount &&
    canvas.totalFileCount === update.totalFileCount
  ) {
    return canvas;
  }

  return {
    ...canvas,
    reviewedCount: update.reviewedCount,
    totalFileCount: update.totalFileCount,
    flows
  };
}

export function applyDecisionUpdateToSummary(
  summary: PrReviewSummary,
  update: PrReviewDecisionUpdatedEvent
): PrReviewSummary {
  if (summary.reviewSessionId !== update.reviewSessionId) {
    return summary;
  }

  return {
    ...summary,
    reviewedCount: update.reviewedCount,
    totalFileCount: update.totalFileCount,
    readyToSubmit: update.readyToSubmit
  };
}
