import { createHash } from "node:crypto";

type ChatRequestPayload = {
  content: string;
  mentionedUserIds: string[];
};

export function canonicalizeChatRequestPayload(
  payload: ChatRequestPayload
): string {
  const mentionedUserIds = Array.from(
    new Set(payload.mentionedUserIds)
  ).sort(compareCodePointOrder);

  return JSON.stringify({
    content: payload.content,
    mentionedUserIds
  });
}

export function computeChatRequestFingerprint(
  payload: ChatRequestPayload
): string {
  return createHash("sha256")
    .update(canonicalizeChatRequestPayload(payload), "utf8")
    .digest("hex");
}

function compareCodePointOrder(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
