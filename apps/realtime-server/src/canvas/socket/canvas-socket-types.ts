import type { Socket } from "socket.io";
import type {
  CanvasAccessContext,
  CanvasRoomAccess,
} from "../room/canvas-access.service";
import type { CanvasRoomRef } from "../contracts/canvas-types";

export type CanvasAuthedSocket = Socket & {
  data: {
    auth: CanvasAccessContext & {
      displayName: string;
    };
    canvasRoomAccess: Map<string, CanvasRoomAccess>;
    canvasRoomsByName: Map<string, CanvasRoomRef>;
  };
};
