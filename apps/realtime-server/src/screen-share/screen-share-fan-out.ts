import { createWorkspacePresenceRoomName } from "../workspace-presence/workspace-presence-socket-handlers";
import {
  readWorkspaceScreenShareRedisEvent,
  type WorkspaceScreenShareRedisEvent,
} from "./screen-share-events";

type WorkspaceScreenShareBrowserPayload = Omit<
  WorkspaceScreenShareRedisEvent,
  "version" | "workspaceId"
>;

export type ScreenShareFanOutOptions = {
  emit: (
    room: string,
    event: WorkspaceScreenShareRedisEvent["event"],
    payload: WorkspaceScreenShareBrowserPayload,
  ) => void;
};

export function createScreenShareFanOut({ emit }: ScreenShareFanOutOptions) {
  return {
    fanOut(value: unknown): boolean {
      const event = readWorkspaceScreenShareRedisEvent(value);
      if (!event) return false;

      const { workspaceId, version: _version, ...browserPayload } = event;
      emit(
        createWorkspacePresenceRoomName(workspaceId),
        event.event,
        browserPayload,
      );
      return true;
    },
  };
}
