import { parseGithubSourceInvalidation } from "./github-source-payload.parser";
import { createGithubSourceRoomName } from "./github-source-room.service";
import { githubSourceServerEvents } from "./github-source-socket-events";
import type { GithubSourceInvalidation } from "./github-source-types";

export function createGithubSourceFanOut({
  emitToRoom
}: {
  emitToRoom: (
    roomName: string,
    event: string,
    payload: GithubSourceInvalidation
  ) => void;
}) {
  return {
    fanOut(payload: unknown) {
      const invalidation = parseGithubSourceInvalidation(payload);
      if (!invalidation) {
        return false;
      }
      emitToRoom(
        createGithubSourceRoomName(invalidation),
        githubSourceServerEvents.invalidated,
        invalidation
      );
      return true;
    }
  };
}
