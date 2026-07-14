import type { CanvasShapeOperationPayload } from "@/shared/canvas-realtime/canvas-realtime-types";

export type PrReviewCanvasOperationReconciliation = {
  contiguousOperations: CanvasShapeOperationPayload[];
  lastSeenOpSeq: number;
  pendingOperations: CanvasShapeOperationPayload[];
};

export function reconcilePrReviewCanvasOperations(
  afterSeq: number,
  operations: CanvasShapeOperationPayload[]
): PrReviewCanvasOperationReconciliation {
  const normalizedAfterSeq = Math.max(0, Math.trunc(afterSeq));
  const operationBySeq = new Map<number, CanvasShapeOperationPayload>();

  for (const operation of operations) {
    if (operation.opSeq > normalizedAfterSeq) {
      operationBySeq.set(operation.opSeq, operation);
    }
  }

  const contiguousOperations: CanvasShapeOperationPayload[] = [];
  let nextOpSeq = normalizedAfterSeq + 1;

  while (operationBySeq.has(nextOpSeq)) {
    contiguousOperations.push(operationBySeq.get(nextOpSeq)!);
    operationBySeq.delete(nextOpSeq);
    nextOpSeq += 1;
  }

  return {
    contiguousOperations,
    lastSeenOpSeq: nextOpSeq - 1,
    pendingOperations: [...operationBySeq.values()].sort(
      (left, right) => left.opSeq - right.opSeq
    )
  };
}
