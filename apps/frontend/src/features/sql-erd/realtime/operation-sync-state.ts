type SequencedOperation = { opSeq: number };

export type SqlErdOperationBuffer<T extends SequencedOperation> = {
  bufferedOperations: T[];
  lastSeenOpSeq: number;
};

type SqlErdOperationCatchUpPage<T extends SequencedOperation> = {
  items: T[];
  latestOpSeq: number;
  nextAfterSeq: number | null;
};

function normalizeSequence(value: number) {
  return Math.max(0, Math.trunc(value));
}

export function bufferSqlErdOperation<T extends SequencedOperation>(
  state: SqlErdOperationBuffer<T>,
  operation: T
): SqlErdOperationBuffer<T> {
  if (operation.opSeq <= state.lastSeenOpSeq) {
    return state;
  }

  return {
    ...state,
    bufferedOperations: [
      ...state.bufferedOperations.filter((entry) => entry.opSeq !== operation.opSeq),
      operation
    ]
  };
}

export function takeContiguousSqlErdOperations<T extends SequencedOperation>(
  state: SqlErdOperationBuffer<T>
) {
  const operations: T[] = [];
  let lastSeenOpSeq = normalizeSequence(state.lastSeenOpSeq);

  state.bufferedOperations
    .slice()
    .sort((left, right) => left.opSeq - right.opSeq)
    .forEach((operation) => {
      if (operation.opSeq !== lastSeenOpSeq + 1) return;
      operations.push(operation);
      lastSeenOpSeq = operation.opSeq;
    });

  return {
    operations,
    state: {
      bufferedOperations: state.bufferedOperations.filter(
        (operation) => operation.opSeq > lastSeenOpSeq
      ),
      lastSeenOpSeq
    } satisfies SqlErdOperationBuffer<T>
  };
}

export async function catchUpSqlErdOperationPages<T extends SequencedOperation>({
  afterSeq,
  applyOperations,
  fetchPage
}: {
  afterSeq: number;
  applyOperations: (operations: T[]) => Promise<void> | void;
  fetchPage: (afterSeq: number) => Promise<SqlErdOperationCatchUpPage<T>>;
}): Promise<number> {
  let lastSeenOpSeq = normalizeSequence(afterSeq);

  while (true) {
    const page = await fetchPage(lastSeenOpSeq);
    const { operations, state } = takeContiguousSqlErdOperations({
      bufferedOperations: page.items,
      lastSeenOpSeq
    });

    if (operations.length !== page.items.length) {
      throw new Error("SQLtoERD operation catch-up page has a sequence gap.");
    }
    if (operations.length) {
      await applyOperations(operations);
    }

    lastSeenOpSeq = state.lastSeenOpSeq;
    if (page.nextAfterSeq === null) {
      return lastSeenOpSeq;
    }
  }
}
