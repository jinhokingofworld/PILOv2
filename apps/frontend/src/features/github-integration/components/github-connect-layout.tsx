import type { ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import type {
  GithubAppInstallation,
  GithubOAuthStatus,
  GithubProjectOAuthStatus,
  GithubProjectV2,
  GithubRepository,
  GithubSyncRun,
  GithubSyncTarget
} from "@/features/github-integration/types";
import { hasRequiredGithubProjectOAuthScopes } from "@/features/github-integration/utils/github-project-oauth-scope";

import { GithubConnectProject } from "./github-connect-project";
import { GithubConnectRepositories } from "./github-connect-repositories";
import { GithubConnectSteps } from "./github-connect-steps";
import { GithubConnectSync } from "./github-connect-sync";

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
  repositoryQuery: string;
  repositoryPage: number;
  hasNextRepositoryPage: boolean;
  selectedRepositoryId: string;
  selectedRepository: GithubRepository | undefined;
  restoredRepository: GithubRepository | null;
  projects: GithubProjectV2[];
  selectedProjectV2Id: string;
  isLoading: boolean;
  isDisconnecting: boolean;
  isDisconnectingProjectOAuth: boolean;
  isDeletingInstallation: boolean;
  isInstallationDeleteRequested: boolean;
  isSyncing: boolean;
  isActivatingProjectV2: boolean;
  isWorkspaceOwner: boolean;
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
  onRepositoryPageChange: (page: number) => void;
  onSelectRepository: (id: string) => void;
  onActivateProjectV2: (projectV2Id: string) => Promise<void>;
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
  repositoryQuery,
  repositoryPage,
  hasNextRepositoryPage,
  selectedRepositoryId,
  selectedRepository,
  restoredRepository,
  projects,
  selectedProjectV2Id,
  isLoading,
  isDisconnecting,
  isDisconnectingProjectOAuth,
  isDeletingInstallation,
  isInstallationDeleteRequested,
  isSyncing,
  isActivatingProjectV2,
  isWorkspaceOwner,
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
  onRepositoryPageChange,
  onSelectRepository,
  onActivateProjectV2,
  onSyncTargetChange,
  onStartSync
}: GithubConnectLayoutProps) {
  const projectOAuthHasRequiredScopes = hasRequiredGithubProjectOAuthScopes(
    projectOAuth?.tokenScope
  );

  return (
    <div className="github-connect-root @container text-foreground">
      <div className="grid gap-4">
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
          isWorkspaceOwner={isWorkspaceOwner}
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
          redirectAction={redirectAction}
          selectedInstallation={selectedInstallation}
        />
        <GithubConnectRepositories
          enabled={installations.length > 0}
          hasNextRepositoryPage={hasNextRepositoryPage}
          isLoading={isLoading}
          onRepositoryPageChange={onRepositoryPageChange}
          onRepositoryQueryChange={onRepositoryQueryChange}
          onSelectRepository={onSelectRepository}
          repositories={repositories}
          repositoriesTotal={repositoriesTotal}
          repositoryPage={repositoryPage}
          repositoryQuery={repositoryQuery}
          restoredRepository={
            restoredRepository?.id === selectedRepositoryId
              ? restoredRepository
              : null
          }
          selectedRepositoryId={selectedRepositoryId}
        />
        <GithubConnectProject
          activeProjectV2Id={selectedProjectV2Id}
          isActivating={isActivatingProjectV2}
          isWorkspaceOwner={isWorkspaceOwner}
          onActivateProjectV2={onActivateProjectV2}
          projectOAuthConnected={projectOAuth?.connected === true && projectOAuthHasRequiredScopes}
          projects={projects}
          selectedRepository={selectedRepository}
        />
        <GithubConnectSync
          installations={installations}
          isLoading={isLoading}
          isSyncing={isSyncing}
          isWorkspaceOwner={isWorkspaceOwner}
          onStartSync={onStartSync}
          onSyncTargetChange={onSyncTargetChange}
          selectedInstallationId={selectedInstallationId}
          selectedProjectV2Id={selectedProjectV2Id}
          selectedRepositoryId={selectedRepositoryId}
          syncRuns={syncRuns}
          syncRunsTotal={syncRunsTotal}
          syncTarget={syncTarget}
        />
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
