import type { MeetingReportSummary } from "@/features/meeting/types";

export function formatMeetingReportTitle(report: MeetingReportSummary) {
  return `${formatMeetingReportDateTime(report.createdAt)} 회의록`;
}

export function formatMeetingReportDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "long"
  }).format(new Date(value));
}

export function getMeetingReportFallbackSummary(report: MeetingReportSummary) {
  if (report.errorMessage?.trim()) {
    return report.errorMessage;
  }

  return report.status === "PROCESSING" ? "요약 생성 중" : "요약이 없습니다";
}
