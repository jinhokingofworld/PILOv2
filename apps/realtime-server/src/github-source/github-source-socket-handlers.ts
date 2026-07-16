import { createSocketErrorPayload } from "../socket/socket-errors";
import type { GithubSourceAccessContext } from "./github-source-access.service";
import { parseGithubSourceRoomRef } from "./github-source-payload.parser";
import {
  createGithubSourceRoomName,
  type createGithubSourceRoomService
} from "./github-source-room.service";
import {
  githubSourceClientEvents,
  githubSourceServerEvents
} from "./github-source-socket-events";

type GithubSourceSocket = {
  emit: (event: string, payload: unknown) => void;
  join: (roomName: string) => unknown | Promise<unknown>;
  leave: (roomName: string) => unknown | Promise<unknown>;
  on: (event: string, listener: (payload: unknown) => void | Promise<void>) => void;
};

export function registerGithubSourceSocketHandlers({
  context,
  roomService,
  socket
}: {
  context: GithubSourceAccessContext;
  roomService: ReturnType<typeof createGithubSourceRoomService>;
  socket: GithubSourceSocket;
}) {
  socket.on(githubSourceClientEvents.subscribe, async (payload) => {
    try {
      const result = await roomService.subscribe(context, payload);
      if (!result.joined) {
        socket.emit(
          githubSourceServerEvents.error,
          createSocketErrorPayload("forbidden", "GitHub source room access denied")
        );
        return;
      }
      await socket.join(result.roomName);
      socket.emit(githubSourceServerEvents.subscribed, result.payload);
    } catch {
      socket.emit(
        githubSourceServerEvents.error,
        createSocketErrorPayload("internal_error", "GitHub source room access failed")
      );
    }
  });

  socket.on(githubSourceClientEvents.unsubscribe, async (payload) => {
    const room = parseGithubSourceRoomRef(payload);
    if (!room) {
      socket.emit(
        githubSourceServerEvents.error,
        createSocketErrorPayload("invalid_payload", "github:source:unsubscribe payload is invalid")
      );
      return;
    }
    try {
      await socket.leave(createGithubSourceRoomName(room));
    } catch {
      socket.emit(
        githubSourceServerEvents.error,
        createSocketErrorPayload("internal_error", "GitHub source room leave failed")
      );
    }
  });
}
