import type { ReactNode } from "react";
import { CheckCircle2, GitBranch, RefreshCcw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  GithubAppInstallation,
  GithubOAuthStatus,
  GithubProjectV2,
  GithubPullRequest,
  GithubRepository,
  GithubSyncRun,
  GithubSyncTarget
} from "@/features/github-integration/types";

import { GithubConnectSidebar } from "./github-connect-sidebar";
import { GithubConnectSourceTables } from "./github-connect-tables";
import { GithubConnectSteps } from "./github-connect-steps";

export type GithubConnectStage = "idle" | "loading" | "ready" | "error";

export type GithubConnectLayoutProps = {
  panelStatus: GithubConnectStage;
  errorMessage: string | null;
  actionError: string | null;
  actionMessage: string | null;
  oauth: GithubOAuthStatus | null;
  selectedInstallationId: string;
  selectedInstallation: GithubAppInstallation | undefined;
  connected: boolean;
  repositories: GithubRepository[];
  repositoriesTotal: number;
  filteredRepositories: GithubRepository[];
  repositoryQuery: string;
  selectedRepositoryId: string;
  selectedRepository: GithubRepository | undefined;
  projects: GithubProjectV2[];
  projectsTotal: number;
  selectedProjectV2Id: string;
  selectedProject: GithubProjectV2 | undefined;
  pullRequests: GithubPullRequest[];
  pullRequestsTotal: number;
  isLoading: boolean;
  isPullRequestsLoading: boolean;
  isDisconnecting: boolean;
  isSyncing: boolean;
  redirectAction: "oauth" | "installation" | null;
  syncRuns: GithubSyncRun[];
  syncRunsTotal: number;
  syncTarget: GithubSyncTarget;
  onRefresh: () => void;
  onStartOAuth: () => void;
  onDisconnectOAuth: () => void;
  onStartInstallation: () => void;
  onRepositoryQueryChange: (value: string) => void;
  onSelectRepository: (id: string) => void;
  onSelectProjectV2: (id: string) => void;
  onSyncTargetChange: (target: GithubSyncTarget) => void;
  onStartSync: () => void;
};

export function GithubConnectLayout({
  panelStatus,
  errorMessage,
  actionError,
  actionMessage,
  oauth,
  selectedInstallationId,
  selectedInstallation,
  connected,
  repositories,
  repositoriesTotal,
  filteredRepositories,
  repositoryQuery,
  selectedRepositoryId,
  selectedRepository,
  projects,
  projectsTotal,
  selectedProjectV2Id,
  selectedProject,
  pullRequests,
  pullRequestsTotal,
  isLoading,
  isPullRequestsLoading,
  isDisconnecting,
  isSyncing,
  redirectAction,
  syncRuns,
  syncRunsTotal,
  syncTarget,
  onRefresh,
  onStartOAuth,
  onDisconnectOAuth,
  onStartInstallation,
  onRepositoryQueryChange,
  onSelectRepository,
  onSelectProjectV2,
  onSyncTargetChange,
  onStartSync
}: GithubConnectLayoutProps) {
  return (
    <div className="github-connect-root -m-6 min-h-[calc(100vh-3.5rem)] bg-[#eceef3] px-6 py-5 text-[#101828]">
      <div className="mx-auto grid max-w-[1204px] gap-[15px]">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-[8px] border border-[#d9dee8] bg-white px-5 py-4 shadow-[0_18px_45px_rgba(15,20,34,0.08)]">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#687184]">
              <GitBranch className="size-4" />
              GitHub Integration
            </p>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight text-[#101828]">
              PILO GitHub Connect
            </h1>
            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[#687184]">
              GitHub OAuth, App 설치, 저장소, Pull Request, Projects v2
              동기화 상태를 한 화면에서 관리합니다.
            </p>
          </div>
          <Button
            className="h-9 rounded-[8px]"
            disabled={isLoading}
            onClick={onRefresh}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCcw data-icon="inline-start" />
            새로고침
          </Button>
        </header>

        {panelStatus === "error" ? (
          <StatusNotice
            icon={<XCircle className="size-4" />}
            tone="danger"
            title="GitHub 연동 정보를 불러오지 못했습니다."
          >
            {errorMessage ?? "잠시 후 다시 시도하세요."}
          </StatusNotice>
        ) : null}

        {actionError ? (
          <StatusNotice
            icon={<XCircle className="size-4" />}
            tone="danger"
            title="작업을 완료하지 못했습니다."
          >
            {actionError}
          </StatusNotice>
        ) : null}

        {actionMessage ? (
          <StatusNotice
            icon={<CheckCircle2 className="size-4" />}
            tone="success"
            title="작업이 완료되었습니다."
          >
            {actionMessage}
          </StatusNotice>
        ) : null}

        <div className="main-grid grid gap-[15px] xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
          <div className="grid gap-[15px]">
            <GithubConnectSteps
              connected={connected}
              isDisconnecting={isDisconnecting}
              isLoading={isLoading}
              oauth={oauth}
              onDisconnectOAuth={onDisconnectOAuth}
              onStartInstallation={onStartInstallation}
              onStartOAuth={onStartOAuth}
              projectsTotal={projectsTotal}
              redirectAction={redirectAction}
              repositoriesTotal={repositoriesTotal}
              selectedInstallation={selectedInstallation}
              selectedProject={selectedProject}
              selectedRepository={selectedRepository}
            />

            <GithubConnectSourceTables
              filteredRepositories={filteredRepositories}
              isLoading={isLoading}
              onRepositoryQueryChange={onRepositoryQueryChange}
              onSelectProjectV2={onSelectProjectV2}
              onSelectRepository={onSelectRepository}
              projects={projects}
              projectsTotal={projectsTotal}
              repositories={repositories}
              repositoriesTotal={repositoriesTotal}
              repositoryQuery={repositoryQuery}
              selectedProjectV2Id={selectedProjectV2Id}
              selectedRepositoryId={selectedRepositoryId}
            />
          </div>

          <GithubConnectSidebar
            isLoading={isLoading}
            isPullRequestsLoading={isPullRequestsLoading}
            isSyncing={isSyncing}
            onStartSync={onStartSync}
            onSyncTargetChange={onSyncTargetChange}
            pullRequests={pullRequests}
            pullRequestsTotal={pullRequestsTotal}
            selectedInstallationId={selectedInstallationId}
            selectedRepository={selectedRepository}
            syncRuns={syncRuns}
            syncRunsTotal={syncRunsTotal}
            syncTarget={syncTarget}
          />
        </div>
      </div>
    </div>
  );
}

function StatusNotice({
  title,
  children,
  icon,
  tone
}: {
  title: string;
  children: string;
  icon: ReactNode;
  tone: "success" | "danger";
}) {
  const className =
    tone === "success"
      ? "border-[#b8e8ca] bg-[#effbf3] text-[#14532d]"
      : "border-[#ffc9c9] bg-[#fff1f1] text-[#b42318]";

  return (
    <div
      className={`rounded-[8px] border px-4 py-3 shadow-[0_10px_28px_rgba(15,20,34,0.05)] ${className}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{title}</p>
          <p className="mt-1 text-[13px] leading-5">{children}</p>
        </div>
      </div>
    </div>
  );
}
