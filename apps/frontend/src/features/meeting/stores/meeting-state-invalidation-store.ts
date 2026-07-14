"use client";

import { useEffect, useRef } from "react";

const listeners = new Set<() => void>();

export function notifyMeetingStateInvalidated() {
  listeners.forEach(listener => listener());
}

export function useMeetingStateInvalidation(
  enabled: boolean,
  onStateInvalidated: () => Promise<unknown> | void
) {
  const onStateInvalidatedRef = useRef(onStateInvalidated);

  useEffect(() => {
    onStateInvalidatedRef.current = onStateInvalidated;
  }, [onStateInvalidated]);

  useEffect(() => {
    if (!enabled) return;

    let isReloading = false;
    let reloadQueued = false;

    const reload = () => {
      if (isReloading) {
        reloadQueued = true;
        return;
      }

      isReloading = true;
      Promise.resolve(onStateInvalidatedRef.current()).finally(() => {
        isReloading = false;
        if (!reloadQueued) return;

        reloadQueued = false;
        reload();
      });
    };

    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [enabled]);
}
