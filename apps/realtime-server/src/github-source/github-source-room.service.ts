import type {
  GithubSourceAccessContext,
  createGithubSourceAccessService
} from "./github-source-access.service";
import { parseGithubSourceRoomRef } from "./github-source-payload.parser";
import type { GithubSourceRoomRef } from "./github-source-types";

export function createGithubSourceRoomName({ workspaceId }: GithubSourceRoomRef) {
  return `workspace:${workspaceId}:github-source`;
}

export function createGithubSourceRoomService({
  accessService
}: {
  accessService: ReturnType<typeof createGithubSourceAccessService>;
}) {
  return {
    async subscribe(context: GithubSourceAccessContext, payload: unknown) {
      const room = parseGithubSourceRoomRef(payload);
      if (
        !room ||
        !(await accessService.canJoinWorkspace(context, room.workspaceId))
      ) {
        return { joined: false } as const;
      }
      return {
        joined: true,
        payload: room,
        roomName: createGithubSourceRoomName(room)
      } as const;
    }
  };
}
