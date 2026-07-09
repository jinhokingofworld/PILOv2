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
    <div className="grid min-h-0 gap-4 md:grid-cols-3 xl:col-span-3 xl:col-start-1 xl:row-start-2">
      <IssuesCard issuesState={issuesState} />
      <PullRequestsCard pullRequestsState={pullRequestsState} />
      <MeetingReportsCard meetingReportsState={meetingReportsState} />
    </div>
  );
}
