import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readHomeSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("HomePage는 전역 Pretendard 설정을 상속한다", async () => {
  const source = await readHomeSource("./page.tsx");

  assert.doesNotMatch(source, /next\/font\/local/);
  assert.match(source, /HomeDashboard/);
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

test("홈 상시 노출 UI는 최대 1920px에서 글자를 3px씩 확대한다", async () => {
  const [
    homeDashboard,
    dashboardCard,
    calendarCard,
    membersCard,
    issuesCard,
    pullRequestsCard,
    meetingReportsCard,
    shortcutCards,
    memberProfileDialog
  ] = await Promise.all([
    readHomeSource("./components/home-dashboard.tsx"),
    readHomeSource("./components/dashboard-card.tsx"),
    readHomeSource("./components/calendar-card.tsx"),
    readHomeSource("./components/members-card.tsx"),
    readHomeSource("./components/issues-card.tsx"),
    readHomeSource("./components/pull-requests-card.tsx"),
    readHomeSource("./components/meeting-reports-card.tsx"),
    readHomeSource("./components/shortcut-cards.tsx"),
    readHomeSource("./components/member-profile-dialog.tsx")
  ]);

  assert.match(homeDashboard, /max-w-\[1920px\]/);
  assert.doesNotMatch(homeDashboard, /max-w-\[1680px\]/);
  assert.match(homeDashboard, /text-\[21px\]/);
  assert.match(homeDashboard, /text-\[16px\]/);

  assert.match(dashboardCard, /text-\[19px\]/);
  assert.match(
    dashboardCard,
    /group-data-\[size=sm\]\/card:text-\[19px\]/
  );
  assert.match(dashboardCard, /text-\[15px\]/);
  assert.doesNotMatch(dashboardCard, /text-\[(?:12|16)px\]/);
  assert.doesNotMatch(dashboardCard, /text-xs/);

  for (const size of ["14", "15", "16", "19"]) {
    assert.match(calendarCard, new RegExp(`text-\\[${size}px\\]`));
  }
  assert.doesNotMatch(calendarCard, /text-\[(?:11|12|13)px\]/);

  assert.match(
    membersCard,
    /aria-label="멤버 초대 열기"[\s\S]*className="text-\[17px\]"/
  );
  assert.match(
    membersCard,
    /aria-label="워크스페이스 나가기"[\s\S]*className="text-\[17px\]"/
  );
  assert.match(membersCard, /truncate text-\[16px\] font-medium/);
  assert.match(membersCard, /truncate text-\[15px\]/);
  assert.match(membersCard, /text-center text-\[15px\]/);
  assert.equal(
    (
      membersCard.match(
        /group-data-\[size=sm\]\/avatar:text-\[15px\]/g
      ) ?? []
    ).length,
    2
  );
  assert.match(membersCard, /h-8[^"]*text-\[13px\]/);
  assert.match(membersCard, /text-\[12px\] text-destructive/);
  assert.match(membersCard, /text-sm text-destructive/);

  assert.match(issuesCard, /text-\[15px\]/);
  assert.match(issuesCard, /text-\[17px\]/);
  assert.match(pullRequestsCard, /text-\[17px\]/);
  assert.match(pullRequestsCard, /text-\[16px\]/);
  assert.match(meetingReportsCard, /text-\[17px\]/);
  assert.match(meetingReportsCard, /text-\[16px\]/);

  assert.match(shortcutCards, /text-\[17px\]/);
  assert.match(shortcutCards, /text-\[15px\]/);
  assert.match(shortcutCards, /text-\[calc\(0\.7rem\+3px\)\]/);
  assert.doesNotMatch(shortcutCards, /text-(?:sm|xs)/);

  assert.match(memberProfileDialog, /text-xs/);
  assert.match(memberProfileDialog, /text-sm/);
  assert.match(memberProfileDialog, /text-base/);
  assert.match(memberProfileDialog, /text-xl/);
});

test("HomeDashboard는 14일을 조회하고 이번 주 7일만 일정에 전달한다", async () => {
  const source = await readHomeSource("./components/home-dashboard.tsx");

  assert.match(source, /getCalendarRangeDates\(today,\s*14\)/);
  assert.match(source, /calendarDates\.slice\(0,\s*7\)/);
  assert.match(source, /calendarDates=\{visibleCalendarDates\}/);
});

test("MembersCard는 숫자 요약 없이 390px 높이 안에서 멤버와 초대 목록을 함께 스크롤한다", async () => {
  const source = await readHomeSource("./components/members-card.tsx");
  const scrollContainers = source.match(/overflow-y-auto/g) ?? [];

  assert.match(source, /title="팀 현황"/);
  assert.doesNotMatch(source, /const teamStats/);
  assert.doesNotMatch(source, /label: "전체"/);
  assert.doesNotMatch(source, /grid grid-cols-3 gap-2/);
  assert.match(source, /className="h-\[390px\] min-h-0"/);
  assert.doesNotMatch(source, /className="h-\[430px\] min-h-0"/);
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

test("CalendarCard는 390px 높이에서 이번 주 7일과 기존 이동 계약을 유지한다", async () => {
  const source = await readHomeSource("./components/calendar-card.tsx");

  assert.match(
    source,
    /className="h-\[390px\] min-h-0 overflow-hidden"/
  );
  assert.doesNotMatch(source, /h-full min-h-\[430px\]/);
  assert.match(source, /이번 주 일정/);
  assert.doesNotMatch(source, /이번 주 · 다음 주 일정/);
  assert.doesNotMatch(source, /향후 2주 일정/);
  assert.match(source, /formatCalendarRangeTitle\(calendarDates\)/);
  assert.match(source, /calendarDates\.map/);
  assert.match(source, /grid-cols-7/);
  assert.doesNotMatch(source, /grid-rows-2/);
  assert.match(source, /오늘 일정/);
  assert.match(source, /bg-muted.*text-muted-foreground/);
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

test("홈 대시보드는 긴 멤버 목록과 초대 대기 항목을 하나의 스크롤 영역으로 제공한다", async () => {
  const source = await readHomeSource("./components/members-card.tsx");

  assert.match(
    source,
    /className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"[\s\S]*<MemberPresencePanel[\s\S]*\{pendingInvitations/
  );
  assert.match(source, /<section className="flex shrink-0 flex-col">/);
  assert.equal((source.match(/overflow-y-auto/g) ?? []).length, 1);
});

test("홈 본문은 shadcn 테마 토큰과 모바일 우선 레이아웃을 사용한다", async () => {
  const [homeDashboard, dashboardCard, calendarCard] = await Promise.all([
    readHomeSource("./components/home-dashboard.tsx"),
    readHomeSource("./components/dashboard-card.tsx"),
    readHomeSource("./components/calendar-card.tsx")
  ]);

  assert.match(homeDashboard, /bg-background/);
  assert.match(homeDashboard, /grid-cols-1[\s\S]*xl:grid-cols/);
  assert.match(dashboardCard, /border-border bg-card/);
  assert.doesNotMatch(dashboardCard, /border-\[#e7e9ee\]|bg-white|text-\[#202124\]/);
  assert.match(calendarCard, /border-border bg-card/);
});

test("Pretendard는 루트에서 한 번 등록되어 모든 화면의 기본 폰트가 된다", async () => {
  const rootDirectory = new URL("../../app/", import.meta.url);
  const [rootLayout, globalsCss, homePage] = await Promise.all([
    readFile(new URL("layout.tsx", rootDirectory), "utf8"),
    readFile(new URL("globals.css", rootDirectory), "utf8"),
    readHomeSource("./page.tsx")
  ]);

  assert.match(rootLayout, /next\/font\/local/);
  assert.match(rootLayout, /\.\/fonts\/PretendardVariable\.woff2/);
  assert.match(rootLayout, /pretendard\.variable/);
  assert.match(globalsCss, /--font-sans:\s*var\(--font-pretendard\)/);
  assert.doesNotMatch(homePage, /next\/font\/local/);
});
