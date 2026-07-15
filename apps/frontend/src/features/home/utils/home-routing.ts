export function buildMeetingReportHref(reportId: string) {
  return `/report?reportId=${encodeURIComponent(reportId)}`;
}
