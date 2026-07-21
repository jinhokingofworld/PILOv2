import type {
  HomeIssuesState,
  HomeMeetingReportsState,
  HomePullRequestsState
} from "../hooks/use-home-dashboard-data";
import { IssuesCard } from "./issues-card";
import { MeetingReportsCard } from "./meeting-reports-card";
import { PullRequestsCard } from "./pull-requests-card";

export function MiddleDashboardCards({
  issuesState,
  meetingReportsState,
  pullRequestsState
}: {
  issuesState: HomeIssuesState;
  meetingReportsState: HomeMeetingReportsState;
  pullRequestsState: HomePullRequestsState;
}) {
  return (
    <div className="grid min-h-0 grid-flow-col auto-cols-[min(20rem,calc(100vw-2rem))] gap-3 overflow-x-auto pb-1 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:pb-0 xl:grid-cols-3">
      <IssuesCard issuesState={issuesState} />
      <PullRequestsCard pullRequestsState={pullRequestsState} />
      <div className="min-h-0 sm:col-span-2 xl:col-span-1">
        <MeetingReportsCard meetingReportsState={meetingReportsState} />
      </div>
    </div>
  );
}
