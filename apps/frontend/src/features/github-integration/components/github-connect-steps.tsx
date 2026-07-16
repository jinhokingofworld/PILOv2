import {
  ExternalLink,
  GitBranch,
  Loader2,
  Play,
  RefreshCcw,
  Trash2,
  Unplug
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  GithubAppInstallation,
  GithubProjectOAuthStatus
} from "@/features/github-integration/types";
import { hasRequiredGithubProjectOAuthScopes } from "@/features/github-integration/utils/github-project-oauth-scope";

import {
  GithubConnectPanel,
  GithubConnectPill
} from "./github-connect-primitives";

type StepsProps = {
  connected: boolean;
  projectOAuth: GithubProjectOAuthStatus | null;
  selectedInstallation: GithubAppInstallation | undefined;
  isLoading: boolean;
  isDisconnecting: boolean;
  isDisconnectingProjectOAuth: boolean;
  isDeletingInstallation: boolean;
  isInstallationDeleteRequested: boolean;
  isSyncing: boolean;
  redirectAction: "oauth" | "installation" | "project_oauth" | null;
  onStartOAuth: () => void;
  onDisconnectOAuth: () => void;
  onStartGithubProjectOAuth: () => void;
  onDisconnectGithubProjectOAuth: () => void;
  onRefresh: () => void;
  onStartSync: () => void;
  onStartInstallation: () => void;
  onRequestDeleteInstallation: () => void;
  onCancelDeleteInstallation: () => void;
  onConfirmDeleteInstallation: () => void;
};

const pendingTaskCardClassName =
  "flex h-full flex-col rounded-[8px] border border-[#d9dee8] bg-[#fbfcfe] p-4";
const completedTaskCardClassName =
  "flex h-full flex-col rounded-[8px] border border-[#b8e8ca] bg-[#f0fdf4] p-4";
const completedDisconnectButtonClassName =
  "h-10 rounded-[8px] border-[#b8e8ca] bg-white px-4 text-[#14532d] hover:bg-[#ecfdf3]";
const completedDestructiveButtonClassName =
  "h-10 rounded-[8px] border-[#ffc9c9] bg-white px-4 text-[#b42318] hover:bg-[#fff1f1]";

export function GithubConnectSteps({
  connected,
  projectOAuth,
  selectedInstallation,
  isLoading,
  isDisconnecting,
  isDisconnectingProjectOAuth,
  isDeletingInstallation,
  isInstallationDeleteRequested,
  isSyncing,
  redirectAction,
  onStartOAuth,
  onDisconnectOAuth,
  onStartGithubProjectOAuth,
  onDisconnectGithubProjectOAuth,
  onRefresh,
  onStartSync,
  onStartInstallation,
  onRequestDeleteInstallation,
  onCancelDeleteInstallation,
  onConfirmDeleteInstallation
}: StepsProps) {
  const hasInstallation = Boolean(selectedInstallation);
  const projectOAuthHasRequiredScopes =
    hasRequiredGithubProjectOAuthScopes(projectOAuth?.tokenScope);
  const projectOAuthConnected =
    projectOAuth?.connected === true && projectOAuthHasRequiredScopes;
  const projectOAuthNeedsReconnect =
    projectOAuth?.connected === true && !projectOAuthHasRequiredScopes;

  return (
    <div className="space-y-[15px]">
      <GithubConnectPanel
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              className="h-9 rounded-[8px] bg-[#3157d5] px-3 text-white hover:bg-[#2447bd]"
              disabled={!hasInstallation || isSyncing || isLoading}
              onClick={onStartSync}
              size="sm"
              type="button"
            >
              {isSyncing ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              동기화 시작
            </Button>
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
          </div>
        }
        icon={<GitBranch className="size-4" />}
        title="현재 작업"
        subtitle="현재 연결 상태에 따라 다음에 필요한 작업만 노출합니다."
      >
        <div className="grid gap-4 @[48rem]:grid-cols-3">
          <div
            className={
              connected ? completedTaskCardClassName : pendingTaskCardClassName
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">
                  OAuth
                </p>
                <h3 className="mt-1 text-[18px] font-semibold text-[#101828]">
                  1. GitHub 계정 연결
                </h3>
              </div>
              <GithubConnectPill tone={connected ? "success" : "warning"}>
                {connected ? "연결됨" : "미연결"}
              </GithubConnectPill>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-[#687184]">
              사용자 OAuth 토큰으로 GitHub App 설치 URL을 발급하고 연결 상태를
              검증합니다.
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-5">
              {connected ? (
                <Button
                  className={completedDisconnectButtonClassName}
                  disabled={isDisconnecting || isLoading}
                  onClick={onDisconnectOAuth}
                  type="button"
                  variant="outline"
                >
                  {isDisconnecting ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Unplug data-icon="inline-start" />
                  )}
                  연결 해제
                </Button>
              ) : (
                <Button
                  className="h-10 rounded-[8px] bg-[#111827] px-4 text-white hover:bg-[#2b3343]"
                  disabled={redirectAction === "oauth" || isLoading}
                  onClick={onStartOAuth}
                  type="button"
                >
                  {redirectAction === "oauth" ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <GitBranch data-icon="inline-start" />
                  )}
                  GitHub로 연결
                </Button>
              )}
            </div>
          </div>

          <div
            className={
              hasInstallation
                ? completedTaskCardClassName
                : pendingTaskCardClassName
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">
                  GitHub App
                </p>
                <h3 className="mt-1 text-[18px] font-semibold text-[#101828]">
                  2. 설치와 데이터 확인
                </h3>
              </div>
              <GithubConnectPill tone={hasInstallation ? "success" : "warning"}>
                {hasInstallation ? "설치됨" : "대기"}
              </GithubConnectPill>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-[#687184]">
              설치 후 백엔드가 저장소, Pull Request, Projects v2 데이터를
              동기화합니다.
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-5">
              {hasInstallation ? (
                <Button
                  className={completedDestructiveButtonClassName}
                  disabled={isDeletingInstallation || isLoading}
                  onClick={onRequestDeleteInstallation}
                  type="button"
                  variant="outline"
                >
                  {isDeletingInstallation ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Trash2 data-icon="inline-start" />
                  )}
                  GitHub에서 App 설치 해제
                </Button>
              ) : (
                <Button
                  className="h-10 rounded-[8px] bg-[#3157d5] px-4 text-white hover:bg-[#2447bd]"
                  disabled={
                    !connected ||
                    redirectAction === "installation" ||
                    isLoading
                  }
                  onClick={onStartInstallation}
                  type="button"
                >
                  {redirectAction === "installation" ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <ExternalLink data-icon="inline-start" />
                  )}
                  GitHub에서 설치 시작
                </Button>
              )}
            </div>
            {isInstallationDeleteRequested && selectedInstallation ? (
              <div className="mt-4 rounded-[8px] border border-[#ffc9c9] bg-[#fff7f7] p-3">
                <p className="text-[13px] font-semibold text-[#b42318]">
                  설치 해제 확인
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[#7a2e2e]">
                  @{selectedInstallation.accountLogin} GitHub App 설치를 GitHub에서
                  해제합니다. 다시 사용하려면 GitHub App을 다시 설치해야 합니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    className="h-8 rounded-[8px]"
                    disabled={isDeletingInstallation}
                    onClick={onConfirmDeleteInstallation}
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    {isDeletingInstallation ? (
                      <Loader2 className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <Trash2 data-icon="inline-start" />
                    )}
                    설치 해제
                  </Button>
                  <Button
                    className="h-8 rounded-[8px]"
                    disabled={isDeletingInstallation}
                    onClick={onCancelDeleteInstallation}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    취소
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div
            className={
              projectOAuthConnected
                ? completedTaskCardClassName
                : pendingTaskCardClassName
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">
                  ProjectV2 OAuth
                </p>
                <h3 className="mt-1 text-[18px] font-semibold text-[#101828]">
                  3. Personal Project access
                </h3>
              </div>
              <GithubConnectPill
                className="shrink-0"
                tone={projectOAuthConnected ? "success" : "warning"}
              >
                {projectOAuthConnected ? "Connected" : "Required"}
              </GithubConnectPill>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-[#687184]">
              Personal ProjectV2 동기화와 상태 쓰기에는 project + repo scopes
              OAuth 토큰이 필요합니다.
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-5">
              {projectOAuthConnected ? (
                <Button
                  className={completedDisconnectButtonClassName}
                  disabled={isDisconnectingProjectOAuth || isLoading}
                  onClick={onDisconnectGithubProjectOAuth}
                  type="button"
                  variant="outline"
                >
                  {isDisconnectingProjectOAuth ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Unplug data-icon="inline-start" />
                  )}
                  연결 해제
                </Button>
              ) : (
                <Button
                  className="h-10 rounded-[8px] bg-[#111827] px-4 text-white hover:bg-[#2b3343]"
                  disabled={redirectAction === "project_oauth" || isLoading}
                  onClick={onStartGithubProjectOAuth}
                  type="button"
                >
                  {redirectAction === "project_oauth" ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <GitBranch data-icon="inline-start" />
                  )}
                  {projectOAuthNeedsReconnect
                    ? "Project access 재연결"
                    : "Project access 연결"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </GithubConnectPanel>
    </div>
  );
}
