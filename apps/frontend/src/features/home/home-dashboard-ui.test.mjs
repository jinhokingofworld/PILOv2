import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readHomeSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("HomePage는 Pretendard Variable을 HomeDashboard 범위에만 적용한다", async () => {
  const source = await readHomeSource("./page.tsx");

  assert.match(source, /next\/font\/local/);
  assert.match(source, /PretendardVariable\.woff2/);
  assert.match(source, /pretendard\.className/);
});

test("HomeDashboard는 시안형 섹션과 기존 바로가기를 조합한다", async () => {
  const source = await readHomeSource("./components/home-dashboard.tsx");

  assert.match(source, /워크스페이스 현황/);
  assert.match(source, /GithubWorkspaceCards/);
  assert.match(source, /min-h-\[128px\]/);
  assert.match(
    source,
    /grid-cols-\[minmax\(260px,0\.66fr\)_minmax\(0,1\.34fr\)\]/
  );
  assert.doesNotMatch(source, /overflow-y-auto/);
});

test("HomeDashboard는 14일을 조회하고 이번 주 7일만 일정에 전달한다", async () => {
  const source = await readHomeSource("./components/home-dashboard.tsx");

  assert.match(source, /getCalendarRangeDates\(today,\s*14\)/);
  assert.match(source, /calendarDates\.slice\(0,\s*7\)/);
  assert.match(source, /calendarDates=\{visibleCalendarDates\}/);
});

test("MembersCard는 숫자 요약 없이 고정 높이 안에서 멤버와 초대 목록을 함께 스크롤한다", async () => {
  const source = await readHomeSource("./components/members-card.tsx");
  const scrollContainers = source.match(/overflow-y-auto/g) ?? [];

  assert.match(source, /title="팀 현황"/);
  assert.doesNotMatch(source, /const teamStats/);
  assert.doesNotMatch(source, /label: "전체"/);
  assert.doesNotMatch(source, /grid grid-cols-3 gap-2/);
  assert.match(source, /className="h-\[430px\] min-h-0"/);
  assert.match(source, /overflow-y-auto/);
  assert.equal(scrollContainers.length, 1);
  assert.match(
    source,
    /className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"[\s\S]*<MemberPresencePanel[\s\S]*\{pendingInvitations/
  );
  assert.doesNotMatch(
    source,
    /<MemberPresenceList[\s\S]*function MemberPresenceList[\s\S]*overflow-y-auto/
  );
  assert.doesNotMatch(source, /scrollbar-width:none/);
  assert.doesNotMatch(source, /placeholder:text-\[#9ba0aa\]/i);
  assert.doesNotMatch(source, /text-\[#5865f2\]/i);
});

test("CalendarCard는 이번 주 7일과 기존 이동 계약을 유지한다", async () => {
  const source = await readHomeSource("./components/calendar-card.tsx");

  assert.match(source, /이번 주 일정/);
  assert.doesNotMatch(source, /이번 주 · 다음 주 일정/);
  assert.doesNotMatch(source, /향후 2주 일정/);
  assert.match(source, /formatCalendarRangeTitle\(calendarDates\)/);
  assert.match(source, /calendarDates\.map/);
  assert.match(source, /grid-cols-7/);
  assert.doesNotMatch(source, /grid-rows-2/);
  assert.match(source, /오늘 일정/);
  assert.match(source, /bg-\[#eef0f4\].*text-\[#656972\]/);
  assert.match(source, /router\.push\(`\/calendar\?date=\$\{dateValue\}`\)/);
  assert.doesNotMatch(source, /calendarDates\.slice\(0,\s*7\)/);
});

test("워크스페이스 현황은 반응형 3개 feed로 구성된다", async () => {
  const source = await readHomeSource(
    "./components/middle-dashboard-cards.tsx"
  );

  assert.match(source, /md:grid-cols-2/);
  assert.match(source, /xl:grid-cols-3/);
  assert.match(source, /md:col-span-2 xl:col-span-1/);
});

test("각 feed는 기존 상세 이동을 유지하며 최대 3개를 표시한다", async () => {
  const [issuesSource, pullRequestsSource, meetingReportsSource] =
    await Promise.all([
      readHomeSource("./components/issues-card.tsx"),
      readHomeSource("./components/pull-requests-card.tsx"),
      readHomeSource("./components/meeting-reports-card.tsx")
    ]);

  assert.match(issuesSource, /issues\.slice\(0,\s*3\)/);
  assert.match(issuesSource, /issuesState\.total/);
  assert.match(issuesSource, /router\.push\(boardIssueHref\)/);
  assert.match(pullRequestsSource, /pullRequests\.slice\(0,\s*3\)/);
  assert.match(pullRequestsSource, /pullRequestsState\.total/);
  assert.match(pullRequestsSource, /pullRequestId: pullRequest\.id/);
  assert.match(pullRequestsSource, /repositoryId: pullRequest\.repositoryId/);
  assert.match(pullRequestsSource, /router\.push\(`\/pr-review\?/);
  assert.match(meetingReportsSource, /reports\.slice\(0,\s*3\)/);
  assert.match(meetingReportsSource, /meetingReportsState\.todayCount/);
  assert.match(
    meetingReportsSource,
    /router\.push\(buildMeetingReportHref\(report\.id\)\)/
  );
  assert.doesNotMatch(issuesSource, /description=\{null\}/);
  assert.doesNotMatch(pullRequestsSource, /description=\{null\}/);
  assert.doesNotMatch(meetingReportsSource, /description=\{null\}/);
});

test("홈의 작은 보조 텍스트는 접근 가능한 muted 색상을 사용한다", async () => {
  const sources = await Promise.all([
    readHomeSource("./components/home-dashboard.tsx"),
    readHomeSource("./components/dashboard-card.tsx"),
    readHomeSource("./components/calendar-card.tsx"),
    readHomeSource("./components/members-card.tsx"),
    readHomeSource("./components/issues-card.tsx"),
    readHomeSource("./components/pull-requests-card.tsx"),
    readHomeSource("./components/meeting-reports-card.tsx")
  ]);

  for (const source of sources) {
    assert.doesNotMatch(source, /#747882/i);
  }
});
