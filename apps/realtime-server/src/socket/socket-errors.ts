export type RealtimeSocketErrorCode =
  | "invalid_payload"
  | "unauthenticated"
  | "forbidden"
  | "room_not_joined"
  | "internal_error";

export type RealtimeSocketErrorPayload = {
  code: RealtimeSocketErrorCode;
  message: string;
  requestId?: string;
};

export function createSocketErrorPayload(
  code: RealtimeSocketErrorCode,
  message: string,
  requestId?: string,
): RealtimeSocketErrorPayload {
  return {
    code,
    message,
    ...(requestId ? { requestId } : {}),
  };
}
