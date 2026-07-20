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
  assert.match(
    source,
    /grid-cols-\[minmax\(260px,0\.66fr\)_minmax\(0,1\.34fr\)\]/
  );
});

test("MembersCard는 기존 멤버 데이터로 팀 현황을 요약한다", async () => {
  const source = await readHomeSource("./components/members-card.tsx");

  assert.match(source, /title="팀 현황"/);
  assert.match(source, /label: "전체"/);
  assert.match(source, /label: "접속 중"/);
  assert.match(source, /label: "오프라인"/);
  assert.match(source, /members\.length/);
  assert.match(source, /onlineMembers\.length/);
  assert.match(source, /offlineMembers\.length/);
});

test("CalendarCard는 14일 전체와 기존 이동 계약을 유지한다", async () => {
  const source = await readHomeSource("./components/calendar-card.tsx");

  assert.match(source, /calendarDates\.map/);
  assert.match(source, /grid-cols-7/);
  assert.match(source, /grid-rows-2/);
  assert.match(source, /오늘 일정/);
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
  assert.match(issuesSource, /router\.push\(boardIssueHref\)/);
  assert.match(pullRequestsSource, /pullRequests\.slice\(0,\s*3\)/);
  assert.match(pullRequestsSource, /pullRequestId: pullRequest\.id/);
  assert.match(pullRequestsSource, /repositoryId: pullRequest\.repositoryId/);
  assert.match(pullRequestsSource, /router\.push\(`\/pr-review\?/);
  assert.match(meetingReportsSource, /reports\.slice\(0,\s*3\)/);
  assert.match(
    meetingReportsSource,
    /router\.push\(buildMeetingReportHref\(report\.id\)\)/
  );
});
