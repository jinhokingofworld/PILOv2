export function buildMeetingReportHref(reportId: string) {
  const searchParams = new URLSearchParams({
    reportId
  });

  return `/meeting?${searchParams.toString()}#report`;
}
