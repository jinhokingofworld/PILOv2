import type { PrReviewRoom } from "@/features/pr-review/types";

export function isVisibleReviewRoom(room: PrReviewRoom) {
  return Boolean(
    room.currentReviewSessionId || room.analyzingReviewSessionId
  );
}

export function getReviewRoomEntrySessionId(room: PrReviewRoom) {
  return room.currentReviewSessionId ?? room.analyzingReviewSessionId;
}

export function isReviewRoomAnalyzingNewRevision(room: PrReviewRoom) {
  return Boolean(
    room.currentReviewSessionId && room.analyzingReviewSessionId
  );
}
