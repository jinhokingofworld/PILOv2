export type CanvasRemoteCursorPoint = {
  x: number;
  y: number;
};

export type CanvasRemoteCursorEntry = {
  cursor: CanvasRemoteCursorPoint;
  displayName?: string;
  userId: string;
};

export type CanvasRemoteCursorPresence = {
  cursor: CanvasRemoteCursorPoint | null;
  displayName?: string;
  userId: string;
};

export type CanvasRemoteCursorStore = {
  getSnapshot: () => readonly CanvasRemoteCursorEntry[];
  subscribe: (listener: () => void) => () => void;
};

export type CanvasRemoteCursorStoreController = CanvasRemoteCursorStore & {
  clear: () => void;
  remove: (userId: string) => void;
  replace: (presence: readonly CanvasRemoteCursorPresence[]) => void;
  upsert: (presence: CanvasRemoteCursorPresence) => void;
};

function isSameCursorEntry(
  previousEntry: CanvasRemoteCursorEntry | undefined,
  nextEntry: CanvasRemoteCursorEntry,
) {
  return (
    previousEntry?.cursor.x === nextEntry.cursor.x &&
    previousEntry.cursor.y === nextEntry.cursor.y &&
    previousEntry.displayName === nextEntry.displayName
  );
}

function toCursorEntry(
  presence: CanvasRemoteCursorPresence,
): CanvasRemoteCursorEntry | null {
  if (
    !presence.cursor ||
    !Number.isFinite(presence.cursor.x) ||
    !Number.isFinite(presence.cursor.y)
  ) {
    return null;
  }

  return {
    cursor: presence.cursor,
    ...(presence.displayName ? { displayName: presence.displayName } : {}),
    userId: presence.userId,
  };
}

function toSortedSnapshot(
  entriesByUserId: ReadonlyMap<string, CanvasRemoteCursorEntry>,
) {
  return [...entriesByUserId.values()].sort((a, b) =>
    a.userId.localeCompare(b.userId),
  );
}

export function createCanvasRemoteCursorStore(): CanvasRemoteCursorStoreController {
  const listeners = new Set<() => void>();
  const entriesByUserId = new Map<string, CanvasRemoteCursorEntry>();
  let snapshot: readonly CanvasRemoteCursorEntry[] = [];

  function publish() {
    snapshot = toSortedSnapshot(entriesByUserId);
    listeners.forEach((listener) => listener());
  }

  function remove(userId: string) {
    if (!entriesByUserId.delete(userId)) {
      return;
    }

    publish();
  }

  return {
    clear() {
      if (!entriesByUserId.size) {
        return;
      }

      entriesByUserId.clear();
      publish();
    },
    getSnapshot() {
      return snapshot;
    },
    remove,
    replace(presence) {
      const nextEntriesByUserId = new Map<string, CanvasRemoteCursorEntry>();

      presence.forEach((entry) => {
        const cursorEntry = toCursorEntry(entry);

        if (cursorEntry) {
          nextEntriesByUserId.set(cursorEntry.userId, cursorEntry);
        }
      });

      const nextSnapshot = toSortedSnapshot(nextEntriesByUserId);
      const hasChanged =
        nextSnapshot.length !== snapshot.length ||
        nextSnapshot.some(
          (entry, index) =>
            entry.userId !== snapshot[index]?.userId ||
            !isSameCursorEntry(snapshot[index], entry),
        );

      if (!hasChanged) {
        return;
      }

      entriesByUserId.clear();
      nextEntriesByUserId.forEach((entry, userId) => {
        entriesByUserId.set(userId, entry);
      });
      snapshot = nextSnapshot;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    upsert(presence) {
      const nextEntry = toCursorEntry(presence);

      if (!nextEntry) {
        remove(presence.userId);
        return;
      }

      if (isSameCursorEntry(entriesByUserId.get(nextEntry.userId), nextEntry)) {
        return;
      }

      entriesByUserId.set(nextEntry.userId, nextEntry);
      publish();
    },
  };
}
