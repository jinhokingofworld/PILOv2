import { createSqlErdRoomName } from "../socket/room-names";
import { isSqlErdOperationPayload, sqlErdServerEvents } from "./sql-erd-socket-events";
import type { SqlErdOperationPayload } from "./sql-erd-types";

type EmitToRoom = (
  roomName: string,
  event: typeof sqlErdServerEvents.operation,
  payload: SqlErdOperationPayload
) => void;

/**
 * Relays only validated, already-persisted operation payloads from the Redis
 * outbox channel. This function intentionally has no database write path.
 */
export function relaySqlErdOperation(
  payload: unknown,
  emitToRoom: EmitToRoom
): boolean {
  if (!isSqlErdOperationPayload(payload)) return false;

  emitToRoom(
    createSqlErdRoomName(payload),
    sqlErdServerEvents.operation,
    payload
  );
  return true;
}
