type ChatSubscriptionOperation = () => Promise<void>;

export function createChatSubscriptionWorkQueue({
  onRejected,
}: {
  onRejected: (error: unknown) => void;
}) {
  const inFlight = new Set<Promise<void>>();
  let chatEventTail: Promise<void> = Promise.resolve();

  function reportRejection(error: unknown): void {
    try {
      onRejected(error);
    } catch {
      // Error reporting must not break queue progress or shutdown draining.
    }
  }

  function track(promise: Promise<void>): Promise<void> {
    let tracked: Promise<void>;
    tracked = promise
      .catch(reportRejection)
      .finally(() => {
        inFlight.delete(tracked);
      });
    inFlight.add(tracked);
    return tracked;
  }

  return {
    enqueueChatEvent(operation: ChatSubscriptionOperation): void {
      chatEventTail = track(chatEventTail.then(operation));
    },
    trackRevocation(operation: ChatSubscriptionOperation): void {
      track(Promise.resolve().then(operation));
    },
    async drain(): Promise<void> {
      while (inFlight.size > 0) {
        await Promise.all([...inFlight]);
      }
    },
  };
}
