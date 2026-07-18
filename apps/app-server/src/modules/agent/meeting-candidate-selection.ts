export const MEETING_CANDIDATE_SELECTION_KIND = "meeting_candidate" as const;

const INTERNAL_SELECTION_PATTERN =
  /^\[PILO_INTERNAL_SELECTION kind=meeting_candidate\]\n([^\r\n]+)$/;

export function buildStoredMeetingCandidateSelectionMessage(label: string): string {
  return `[PILO_INTERNAL_SELECTION kind=${MEETING_CANDIDATE_SELECTION_KIND}]\n${label} 후보를 선택했습니다.`;
}

export function toPublicMeetingCandidateSelectionMessage(content: string): string {
  return INTERNAL_SELECTION_PATTERN.exec(content)?.[1] ?? content;
}
