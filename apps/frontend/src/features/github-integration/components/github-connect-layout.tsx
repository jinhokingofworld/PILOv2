import type { ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import type {
  GithubAppInstallation,
  GithubOAuthStatus,
  GithubProjectOAuthStatus,
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
  projectOAuth: GithubProjectOAuthStatus | null;
  selectedInstallationId: string;
  selectedInstallation: GithubAppInstallation | undefined;
  installations: GithubAppInstallation[];
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
  selectedProjectV2Ids: ReadonlySet<string>;
  selectedProject: GithubProjectV2 | undefined;
  pullRequests: GithubPullRequest[];
  pullRequestsTotal: number;
  isLoading: boolean;
  isPullRequestsLoading: boolean;
  isDisconnecting: boolean;
  isDisconnectingProjectOAuth: boolean;
  isDeletingInstallation: boolean;
  isInstallationDeleteRequested: boolean;
  isSyncing: boolean;
  isSavingProjectV2Selections: boolean;
  redirectAction: "oauth" | "installation" | "project_oauth" | null;
  syncRuns: GithubSyncRun[];
  syncRunsTotal: number;
  syncTarget: GithubSyncTarget;
  onRefresh: () => void;
  onStartOAuth: () => void;
  onDisconnectOAuth: () => void;
  onStartGithubProjectOAuth: () => void;
  onDisconnectGithubProjectOAuth: () => void;
  onStartInstallation: () => void;
  onRequestDeleteInstallation: () => void;
  onCancelDeleteInstallation: () => void;
  onConfirmDeleteInstallation: () => void;
  onRepositoryQueryChange: (value: string) => void;
  onSelectRepository: (id: string) => void;
  onSelectProjectV2: (id: string) => void;
  onToggleProjectV2Selection: (id: string) => void;
  onSaveProjectV2Selections: () => void;
  onSyncTargetChange: (target: GithubSyncTarget) => void;
  onStartSync: () => void;
};

export function GithubConnectLayout({
  panelStatus,
  errorMessage,
  actionError,
  actionMessage,
  oauth,
  projectOAuth,
  selectedInstallationId,
  selectedInstallation,
  installations,
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
  selectedProjectV2Ids,
  selectedProject,
  pullRequests,
  pullRequestsTotal,
  isLoading,
  isPullRequestsLoading,
  isDisconnecting,
  isDisconnectingProjectOAuth,
  isDeletingInstallation,
  isInstallationDeleteRequested,
  isSyncing,
  isSavingProjectV2Selections,
  redirectAction,
  syncRuns,
  syncRunsTotal,
  syncTarget,
  onRefresh,
  onStartOAuth,
  onDisconnectOAuth,
  onStartGithubProjectOAuth,
  onDisconnectGithubProjectOAuth,
  onStartInstallation,
  onRequestDeleteInstallation,
  onCancelDeleteInstallation,
  onConfirmDeleteInstallation,
  onRepositoryQueryChange,
  onSelectRepository,
  onSelectProjectV2,
  onToggleProjectV2Selection,
  onSaveProjectV2Selections,
  onSyncTargetChange,
  onStartSync
}: GithubConnectLayoutProps) {
  return (
      <div className="github-connect-root -m-6 min-h-[calc(100vh-3.5rem)] bg-[#eceef3] px-6 py-5 text-[#101828]">
        <div className="mx-auto grid max-w-[1204px] gap-[15px]">
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

        <GithubConnectSteps
          connected={connected}
          isDisconnecting={isDisconnecting}
          isDisconnectingProjectOAuth={isDisconnectingProjectOAuth}
          isDeletingInstallation={isDeletingInstallation}
          isInstallationDeleteRequested={isInstallationDeleteRequested}
          isLoading={isLoading}
          isSyncing={isSyncing}
          projectOAuth={projectOAuth}
          onCancelDeleteInstallation={onCancelDeleteInstallation}
          onConfirmDeleteInstallation={onConfirmDeleteInstallation}
          onDisconnectOAuth={onDisconnectOAuth}
          onDisconnectGithubProjectOAuth={onDisconnectGithubProjectOAuth}
          onRequestDeleteInstallation={onRequestDeleteInstallation}
          onRefresh={onRefresh}
          onStartInstallation={onStartInstallation}
          onStartGithubProjectOAuth={onStartGithubProjectOAuth}
          onStartOAuth={onStartOAuth}
          onStartSync={onStartSync}
          redirectAction={redirectAction}
          selectedInstallation={selectedInstallation}
        />

        <div className="main-grid grid items-start gap-[15px] xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
          <GithubConnectSourceTables
            filteredRepositories={filteredRepositories}
            isLoading={isLoading}
            onRepositoryQueryChange={onRepositoryQueryChange}
            onSelectProjectV2={onSelectProjectV2}
            onToggleProjectV2Selection={onToggleProjectV2Selection}
            onSaveProjectV2Selections={onSaveProjectV2Selections}
            onSelectRepository={onSelectRepository}
            projects={projects}
            projectsTotal={projectsTotal}
            pullRequests={pullRequests}
            pullRequestsTotal={pullRequestsTotal}
            repositories={repositories}
            repositoriesTotal={repositoriesTotal}
            repositoryQuery={repositoryQuery}
            selectedRepository={selectedRepository}
            selectedProjectV2Id={selectedProjectV2Id}
            selectedProjectV2Ids={selectedProjectV2Ids}
            isSavingProjectV2Selections={isSavingProjectV2Selections}
            selectedRepositoryId={selectedRepositoryId}
            isPullRequestsLoading={isPullRequestsLoading}
          />

          <GithubConnectSidebar
            isLoading={isLoading}
            isSyncing={isSyncing}
            onStartSync={onStartSync}
            onSyncTargetChange={onSyncTargetChange}
            installations={installations}
            selectedInstallationId={selectedInstallationId}
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
