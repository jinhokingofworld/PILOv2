import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Loader2,
  ShieldCheck,
  Trash2,
  Unplug
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  GithubAppInstallation,
  GithubOAuthStatus,
  GithubProjectV2,
  GithubRepository
} from "@/features/github-integration/types";
import {
  formatGithubConnectDateTime,
  formatGithubConnectNumber
} from "@/features/github-integration/utils/github-connect-format";

import {
  GithubConnectFieldRow,
  GithubConnectPanel,
  GithubConnectPill
} from "./github-connect-primitives";

type StepsProps = {
  connected: boolean;
  oauth: GithubOAuthStatus | null;
  selectedInstallation: GithubAppInstallation | undefined;
  repositoriesTotal: number;
  projectsTotal: number;
  selectedRepository: GithubRepository | undefined;
  selectedProject: GithubProjectV2 | undefined;
  isLoading: boolean;
  isDisconnecting: boolean;
  isDeletingInstallation: boolean;
  isInstallationDeleteRequested: boolean;
  redirectAction: "oauth" | "installation" | null;
  onStartOAuth: () => void;
  onDisconnectOAuth: () => void;
  onStartInstallation: () => void;
  onRequestDeleteInstallation: () => void;
  onCancelDeleteInstallation: () => void;
  onConfirmDeleteInstallation: () => void;
};

export function GithubConnectSteps({
  connected,
  oauth,
  selectedInstallation,
  repositoriesTotal,
  projectsTotal,
  selectedRepository,
  selectedProject,
  isLoading,
  isDisconnecting,
  isDeletingInstallation,
  isInstallationDeleteRequested,
  redirectAction,
  onStartOAuth,
  onDisconnectOAuth,
  onStartInstallation,
  onRequestDeleteInstallation,
  onCancelDeleteInstallation,
  onConfirmDeleteInstallation
}: StepsProps) {
  const hasInstallation = Boolean(selectedInstallation);

  return (
    <div className="space-y-[15px]">
      <GithubConnectPanel
        icon={<ShieldCheck className="size-4" />}
        title="연결 진행"
        subtitle="OAuth 연결과 GitHub App 설치가 끝나면 저장소와 Project 데이터를 확인할 수 있습니다."
      >
        <div className="stepper grid gap-3 md:grid-cols-2">
          <StepCard
            active={!hasInstallation}
            complete={hasInstallation}
            description={
              connected
                ? `@${oauth?.githubLogin ?? "unknown"} 계정 OAuth 연결 완료`
                : "GitHub 계정을 PILO와 연결합니다."
            }
            eyebrow="01"
            title="GitHub App 설치"
          />
          <StepCard
            active={hasInstallation}
            complete={hasInstallation && repositoriesTotal + projectsTotal > 0}
            description={
              hasInstallation
                ? "백엔드가 검증한 저장소와 Projects v2 목록을 확인합니다."
                : "설치가 끝난 뒤 동기화된 데이터를 확인합니다."
            }
            eyebrow="02"
            title="연결 데이터 확인"
          />
        </div>
      </GithubConnectPanel>

      <GithubConnectPanel
        action={
          connected ? (
            <Button
              className="h-9 rounded-[8px]"
              disabled={isDisconnecting || isLoading}
              onClick={onDisconnectOAuth}
              size="sm"
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
          ) : null
        }
        icon={<GitBranch className="size-4" />}
        title="현재 작업"
        subtitle="현재 연결 상태에 따라 다음에 필요한 작업만 노출합니다."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
          <div className="rounded-[8px] border border-[#d9dee8] bg-[#fbfcfe] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">
                  OAuth
                </p>
                <h3 className="mt-1 text-[18px] font-semibold text-[#101828]">
                  GitHub 계정 연결
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
            <div className="mt-4">
              <Button
                className="h-10 rounded-[8px] bg-[#111827] px-4 text-white hover:bg-[#2b3343]"
                disabled={connected || redirectAction === "oauth" || isLoading}
                onClick={onStartOAuth}
                type="button"
              >
                {redirectAction === "oauth" ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <GitBranch data-icon="inline-start" />
                )}
                GitHub로 연결
              </Button>
            </div>
            <dl className="mt-4 rounded-[8px] border border-[#e5e9f2] bg-white px-4">
              <GithubConnectFieldRow
                label="연결 계정"
                value={connected ? `@${oauth?.githubLogin ?? "unknown"}` : "-"}
              />
              <GithubConnectFieldRow
                label="설치 URL API"
                value={<code>/me/github/oauth/start</code>}
              />
              <GithubConnectFieldRow
                label="콜백 검증 API"
                value={<code>/me/github/oauth/callback</code>}
              />
              <GithubConnectFieldRow
                label="요청 권한"
                value={oauth?.tokenScope || "read:user, repo, project"}
              />
            </dl>
          </div>

          <div className="rounded-[8px] border border-[#d9dee8] bg-[#fbfcfe] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">
                  GitHub App
                </p>
                <h3 className="mt-1 text-[18px] font-semibold text-[#101828]">
                  설치와 데이터 확인
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
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                className="h-10 rounded-[8px] bg-[#3157d5] px-4 text-white hover:bg-[#2447bd]"
                disabled={
                  !connected ||
                  hasInstallation ||
                  redirectAction === "installation" ||
                  isLoading
                }
                onClick={onStartInstallation}
                type="button"
              >
                {redirectAction === "installation" ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ExternalLink data-icon="inline-start" />
                )}
                GitHub에서 설치 시작
              </Button>
              {hasInstallation ? (
                <Button
                  className="h-10 rounded-[8px]"
                  disabled={isDeletingInstallation || isLoading}
                  onClick={onRequestDeleteInstallation}
                  type="button"
                  variant="destructive"
                >
                  {isDeletingInstallation ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Trash2 data-icon="inline-start" />
                  )}
                  GitHub에서 App 설치 해제
                </Button>
              ) : null}
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
            <dl className="mt-4 rounded-[8px] border border-[#e5e9f2] bg-white px-4">
              <GithubConnectFieldRow
                label="돌아온 뒤"
                value="installation callback 검증 후 저장소와 Project 목록 갱신"
              />
              <GithubConnectFieldRow
                label="설치 계정"
                value={selectedInstallation?.accountLogin ?? "-"}
              />
              <GithubConnectFieldRow
                label="허용 저장소"
                value={`${formatGithubConnectNumber(repositoriesTotal)}개`}
              />
              <GithubConnectFieldRow
                label="Projects"
                value={`${formatGithubConnectNumber(projectsTotal)}개`}
              />
              <GithubConnectFieldRow
                label="대표 저장소"
                value={selectedRepository?.fullName ?? "-"}
              />
              <GithubConnectFieldRow
                label="대표 Project"
                value={selectedProject?.title ?? "-"}
              />
              <GithubConnectFieldRow
                label="마지막 동기화"
                value={formatGithubConnectDateTime(
                  selectedInstallation?.lastSyncedAt ?? null
                )}
              />
            </dl>
          </div>
        </div>
      </GithubConnectPanel>
    </div>
  );
}

function StepCard({
  eyebrow,
  title,
  description,
  active,
  complete
}: {
  eyebrow: string;
  title: string;
  description: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <article
      className={`step-card rounded-[8px] border p-4 transition-colors ${
        active || complete
          ? "border-[#c7d2fe] bg-[#f5f7ff]"
          : "border-[#e1e6ef] bg-[#fbfcfe]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#111827] text-[12px] font-semibold text-white">
          {eyebrow}
        </span>
        {complete ? (
          <CheckCircle2 className="size-5 shrink-0 text-[#159947]" />
        ) : null}
      </div>
      <h3 className="mt-3 text-[15px] font-semibold text-[#101828]">
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-5 text-[#687184]">
        {description}
      </p>
    </article>
  );
}
