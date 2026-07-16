"use client";

export type MeetingConnectionAction = {
  actionId: string;
  meetingId: string;
  meetingRoomId?: string;
  expiresAtMs: number;
  workspaceId: string;
};

type MeetingConnectionActionListener = () => void;

const listeners = new Set<MeetingConnectionActionListener>();
const handledActionExpirations = new Map<string, number>();

let pendingAction: MeetingConnectionAction | null = null;

function pruneHandledActions(nowMs: number) {
  handledActionExpirations.forEach((expiresAtMs, actionId) => {
    if (expiresAtMs <= nowMs) {
      handledActionExpirations.delete(actionId);
    }
  });
}

export function enqueueMeetingConnectionAction(
  action: MeetingConnectionAction,
  nowMs = Date.now()
) {
  pruneHandledActions(nowMs);

  if (
    action.expiresAtMs <= nowMs ||
    handledActionExpirations.has(action.actionId)
  ) {
    return false;
  }

  handledActionExpirations.set(action.actionId, action.expiresAtMs);
  pendingAction = action;
  listeners.forEach((listener) => listener());
  return true;
}

export function consumeMeetingConnectionAction(nowMs = Date.now()) {
  const action = pendingAction;
  pendingAction = null;

  if (!action || action.expiresAtMs <= nowMs) {
    return null;
  }

  return action;
}

export function subscribeMeetingConnectionAction(
  listener: MeetingConnectionActionListener
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
