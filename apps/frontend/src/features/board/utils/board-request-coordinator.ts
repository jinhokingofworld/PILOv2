export type BoardRequestOutcome<T> =
  | { status: "applied"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "stale" };

export type BoardMutationLease = {
  finish: () => void;
};

export type BoardRequestCoordinator = {
  beginMutation: () => BoardMutationLease;
  invalidate: () => void;
  run: <T>(request: () => Promise<T>) => Promise<BoardRequestOutcome<T>>;
};

type QueuedBoardRequest = {
  discard: () => void;
  execute: () => void;
  generation: number;
};

export function resolveBackgroundSnapshot<T>(
  currentSnapshot: T,
  outcome: BoardRequestOutcome<T>
): T {
  return outcome.status === "applied" ? outcome.value : currentSnapshot;
}

export function createBoardRequestCoordinator(): BoardRequestCoordinator {
  let generation = 0;
  let mutationCount = 0;
  let queuedRequest: QueuedBoardRequest | null = null;

  async function executeRequest<T>(
    requestGeneration: number,
    request: () => Promise<T>
  ): Promise<BoardRequestOutcome<T>> {
    try {
      const value = await request();
      if (requestGeneration !== generation || mutationCount > 0) {
        return { status: "stale" };
      }

      return { status: "applied", value };
    } catch (error) {
      if (requestGeneration !== generation || mutationCount > 0) {
        return { status: "stale" };
      }

      return { status: "failed", error };
    }
  }

  function discardQueuedRequest() {
    const request = queuedRequest;
    queuedRequest = null;
    request?.discard();
  }

  function invalidate() {
    generation += 1;
    discardQueuedRequest();
  }

  function executeQueuedRequest() {
    if (mutationCount > 0 || !queuedRequest) {
      return;
    }

    const request = queuedRequest;
    queuedRequest = null;
    if (request.generation !== generation) {
      request.discard();
      return;
    }

    request.execute();
  }

  function run<T>(
    request: () => Promise<T>
  ): Promise<BoardRequestOutcome<T>> {
    const requestGeneration = generation + 1;
    generation = requestGeneration;

    if (mutationCount === 0) {
      return executeRequest(requestGeneration, request);
    }

    discardQueuedRequest();
    return new Promise<BoardRequestOutcome<T>>((resolve) => {
      queuedRequest = {
        discard() {
          resolve({ status: "stale" });
        },
        execute() {
          void executeRequest(requestGeneration, request).then(resolve);
        },
        generation: requestGeneration
      };
    });
  }

  return {
    beginMutation() {
      let finished = false;
      if (mutationCount === 0) {
        invalidate();
      }
      mutationCount += 1;

      return {
        finish() {
          if (finished) {
            return;
          }

          finished = true;
          mutationCount -= 1;
          executeQueuedRequest();
        }
      };
    },
    invalidate,
    run
  };
}
