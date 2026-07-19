import {
  CheckCircle2,
  CircleDotDashed,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCcw,
  LockKeyhole,
  Trash2,
  Unplug
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  GithubAppInstallation,
  GithubProjectOAuthStatus
} from "@/features/github-integration/types";
import { hasRequiredGithubProjectOAuthScopes } from "@/features/github-integration/utils/github-project-oauth-scope";
import { getGithubSettingsAccessState } from "@/features/github-integration/utils/github-settings-access";

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
  redirectAction: "oauth" | "installation" | "project_oauth" | null;
  onStartOAuth: () => void;
  onDisconnectOAuth: () => void;
  onStartGithubProjectOAuth: () => void;
  onDisconnectGithubProjectOAuth: () => void;
  onRefresh: () => void;
  onStartInstallation: () => void;
  onRequestDeleteInstallation: () => void;
  onCancelDeleteInstallation: () => void;
  onConfirmDeleteInstallation: () => void;
};

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
  redirectAction,
  onStartOAuth,
  onDisconnectOAuth,
  onStartGithubProjectOAuth,
  onDisconnectGithubProjectOAuth,
  onRefresh,
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
  const access = getGithubSettingsAccessState({
    connected,
    hasInstallation,
    projectOAuthConnected
  });

  return (
    <div className="space-y-[15px]">
      <GithubConnectPanel
        action={
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
        }
        icon={<GitBranch className="size-4" />}
        title="GitHub 연결"
        subtitle="연결 단계를 순서대로 완료하면 보드 작업을 시작할 수 있습니다."
        tone="connection"
      >
        <div className="mt-1 divide-y divide-[#e4e7ec]">
          <div className={`relative grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-b border-[#edf0f4] py-3 before:absolute before:left-[9px] before:top-8 before:h-[calc(100%-16px)] before:w-px before:bg-[#d9dee8] ${connected ? "bg-[#f8fcf9]" : "bg-[#fffaf0]"}`}>
            <span aria-hidden="true" className="relative z-10 text-[#247044]">
              {connected ? <CheckCircle2 className="size-5" /> : <CircleDotDashed className="size-5 text-[#9a5f00]" />}
            </span>
            <div className="col-start-2 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">
                  OAuth
                </p>
                <h3 className="mt-0.5 text-[14px] font-semibold text-[#101828]">
                  1. GitHub 계정 연결
                </h3>
              </div>
              <GithubConnectPill
                tone={access.githubStepStatus === "complete" ? "success" : "warning"}
              >
                {connected ? "연결됨" : "미연결"}
              </GithubConnectPill>
            </div>
            <p className="col-start-2 text-[12px] leading-4 text-[#687184]">
              사용자 OAuth 토큰으로 GitHub App 설치 URL을 발급하고 연결 상태를 검증합니다.
            </p>
            <div className="col-start-3 row-span-2 row-start-1 flex shrink-0 flex-wrap gap-2">
              {connected ? (
                <Button className={completedDisconnectButtonClassName} disabled={isDisconnecting || isLoading} onClick={onDisconnectOAuth} type="button" variant="outline">
                  {isDisconnecting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Unplug data-icon="inline-start" />}
                  연결 해제
                </Button>
              ) : (
                <Button className="h-10 rounded-[8px] bg-[#111827] px-4 text-white hover:bg-[#2b3343]" disabled={redirectAction === "oauth" || isLoading} onClick={onStartOAuth} type="button">
                  {redirectAction === "oauth" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <GitBranch data-icon="inline-start" />}
                  GitHub로 연결
                </Button>
              )}
            </div>
          </div>

          <div className={`relative grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-b border-[#edf0f4] py-3 before:absolute before:left-[9px] before:top-8 before:h-[calc(100%-16px)] before:w-px before:bg-[#d9dee8] ${hasInstallation ? "bg-[#f8fcf9]" : access.canInstallGithubApp ? "bg-[#f8f9ff]" : "opacity-55"}`}>
            <span aria-hidden="true" className="relative z-10 text-[#3658c7]">
              {hasInstallation ? <CheckCircle2 className="size-5 text-[#247044]" /> : access.canInstallGithubApp ? <CircleDotDashed className="size-5" /> : <LockKeyhole className="size-5 text-[#6f7887]" />}
            </span>
            <div className="col-start-2 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">GitHub App</p>
                <h3 className="mt-0.5 text-[14px] font-semibold text-[#101828]">2. GitHub App 설치</h3>
              </div>
              <GithubConnectPill tone={access.installationStepStatus === "complete" ? "success" : "warning"}>
                {hasInstallation ? "설치됨" : access.canInstallGithubApp ? "필요" : "1단계 필요"}
              </GithubConnectPill>
            </div>
            <p className="col-start-2 text-[12px] leading-4 text-[#687184]">
              설치 후 백엔드가 저장소, Pull Request, Projects v2 데이터를 동기화합니다.
            </p>
            <div className="col-start-3 row-span-2 row-start-1 flex shrink-0 flex-wrap gap-2">
              {hasInstallation ? (
                <Button className={completedDestructiveButtonClassName} disabled={isDeletingInstallation || isLoading} onClick={onRequestDeleteInstallation} type="button" variant="outline">
                  {isDeletingInstallation ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
                  GitHub에서 App 설치 해제
                </Button>
              ) : (
                <Button
                  className="h-10 rounded-[8px] bg-[#3157d5] px-4 text-white hover:bg-[#2447bd]"
                  disabled={!access.canInstallGithubApp || isLoading || redirectAction === "installation"}
                  onClick={onStartInstallation}
                  type="button"
                >
                  {redirectAction === "installation" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ExternalLink data-icon="inline-start" />}
                  {access.canInstallGithubApp ? "설치 시작" : "1단계 필요"}
                </Button>
              )}
            </div>
            {isInstallationDeleteRequested && selectedInstallation ? (
              <div className="col-span-2 col-start-2 rounded-[8px] border border-[#ffc9c9] bg-[#fff7f7] p-3">
                <p className="text-[13px] font-semibold text-[#b42318]">설치 해제 확인</p>
                <p className="mt-1 text-[13px] leading-5 text-[#7a2e2e]">
                  @{selectedInstallation.accountLogin} GitHub App 설치를 GitHub에서 해제합니다. 다시 사용하려면 GitHub App을 다시 설치해야 합니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button className="h-8 rounded-[8px]" disabled={isDeletingInstallation} onClick={onConfirmDeleteInstallation} size="sm" type="button" variant="destructive">
                    {isDeletingInstallation ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
                    설치 해제
                  </Button>
                  <Button className="h-8 rounded-[8px]" disabled={isDeletingInstallation} onClick={onCancelDeleteInstallation} size="sm" type="button" variant="outline">
                    취소
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className={`relative grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 py-3 ${projectOAuthConnected ? "bg-[#f8fcf9]" : access.canConnectProjectOAuth ? "bg-[#f8f9ff]" : "opacity-55"}`}>
            <span aria-hidden="true" className="relative z-10 text-[#3658c7]">
              {projectOAuthConnected ? <CheckCircle2 className="size-5 text-[#247044]" /> : access.canConnectProjectOAuth ? <CircleDotDashed className="size-5" /> : <LockKeyhole className="size-5 text-[#6f7887]" />}
            </span>
            <div className="col-start-2 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">ProjectV2 OAuth</p>
                <h3 className="mt-0.5 text-[14px] font-semibold text-[#101828]">3. Project 작업 권한</h3>
              </div>
              <GithubConnectPill className="shrink-0" tone={projectOAuthConnected ? "success" : "warning"}>
                {projectOAuthConnected ? "연결됨" : access.canConnectProjectOAuth ? "보드 편집 권한 필요" : "2단계 필요"}
              </GithubConnectPill>
            </div>
            <p className="col-start-2 text-[12px] leading-4 text-[#687184]">
              Project 조회 · 확장 → 카드 이동 → 댓글 생성 작업에 필요한 권한입니다.
            </p>
            <div className="col-start-3 row-span-2 row-start-1 flex shrink-0 flex-wrap gap-2">
              {projectOAuthConnected ? (
                <Button className={completedDisconnectButtonClassName} disabled={isDisconnectingProjectOAuth || isLoading} onClick={onDisconnectGithubProjectOAuth} type="button" variant="outline">
                  {isDisconnectingProjectOAuth ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Unplug data-icon="inline-start" />}
                  연결 해제
                </Button>
              ) : (
                <Button
                  className="h-10 rounded-[8px] bg-[#111827] px-4 text-white hover:bg-[#2b3343]"
                  disabled={!access.canConnectProjectOAuth || isLoading || redirectAction === "project_oauth"}
                  onClick={onStartGithubProjectOAuth}
                  type="button"
                >
                  {redirectAction === "project_oauth" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <GitBranch data-icon="inline-start" />}
                  {access.canConnectProjectOAuth ? projectOAuthNeedsReconnect ? "Project 작업 권한 재연결" : "Project 작업 권한 연결" : "2단계 필요"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </GithubConnectPanel>
    </div>
  );
}
