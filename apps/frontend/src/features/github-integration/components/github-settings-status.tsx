"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlert, GitBranch, KeyRound, Loader2, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/features/auth";
import { createGithubIntegrationApiClient } from "@/features/github-integration/api/client";
import type {
  GithubAppInstallation,
  GithubOAuthStatus,
  GithubProjectOAuthStatus
} from "@/features/github-integration/types";

type GithubSettingsStatusProps = {
  canManageWorkspace: boolean;
  onManage: () => void;
};

type GithubSettingsSnapshot = {
  installations: GithubAppInstallation[];
  oauth: GithubOAuthStatus;
  projectOAuth: GithubProjectOAuthStatus;
};

export function GithubSettingsStatus({
  canManageWorkspace,
  onManage
}: GithubSettingsStatusProps) {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const apiClient = useMemo(
    () => createGithubIntegrationApiClient({ accessToken: authSession?.accessToken }),
    [authSession?.accessToken]
  );
  const [snapshot, setSnapshot] = useState<GithubSettingsSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setSnapshot(null);
      setErrorMessage("활성 워크스페이스를 찾을 수 없습니다.");
      return;
    }

    let cancelled = false;
    setSnapshot(null);
    setErrorMessage(null);

    void Promise.all([
      apiClient.getGithubOAuthStatus(),
      apiClient.getGithubProjectOAuthStatus(),
      apiClient.listGithubAppInstallations(workspaceId)
    ])
      .then(([oauth, projectOAuth, installations]) => {
        if (!cancelled) setSnapshot({ installations, oauth, projectOAuth });
      })
      .catch(() => {
        if (!cancelled) setErrorMessage("GitHub 연결 상태를 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, workspaceId]);

  return (
    <div className="grid gap-2">
      {errorMessage ? (
        <StatusMessage icon={CircleAlert}>{errorMessage}</StatusMessage>
      ) : !snapshot ? (
        <StatusMessage icon={Loader2}>GitHub 연결 상태를 불러오는 중입니다.</StatusMessage>
      ) : (
        <>
          <StatusCard account={snapshot.oauth.githubLogin} connected={snapshot.oauth.connected} description="PILO에서 사용하는 GitHub 계정 연결" icon={GitBranch} title="GitHub OAuth" />
          <StatusCard account={snapshot.projectOAuth.githubLogin} connected={snapshot.projectOAuth.connected} description="개인 ProjectV2 조회와 상태 변경 권한" icon={KeyRound} title="GitHub Project OAuth" />
          <InstallationCard installations={snapshot.installations} />
        </>
      )}
      <GithubManagementAction canManageWorkspace={canManageWorkspace} onManage={onManage} />
    </div>
  );
}

function GithubManagementAction({ canManageWorkspace, onManage }: GithubSettingsStatusProps) {
  return (
    <div className="flex justify-end">
      <Button disabled={!canManageWorkspace} onClick={onManage} size="sm" variant="outline">
        {canManageWorkspace ? "연결 관리" : "조회 전용"}
      </Button>
    </div>
  );
}

function StatusCard({ account, connected, description, icon: Icon, title }: { account: string | null; connected: boolean; description: string; icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{title}</p>
          <span className={connected ? "text-[11px] text-emerald-600" : "text-[11px] text-muted-foreground"}>{connected ? "연결됨" : "미연결"}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{connected ? account ?? "연결된 GitHub 계정" : "연결된 GitHub 계정이 없습니다."}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function InstallationCard({ installations }: { installations: GithubAppInstallation[] }) {
  const installation = installations[0];

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><GitBranch className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">GitHub App 설치</p>
        {installation ? (
          <>
            <p className="truncate text-xs text-muted-foreground">{installation.accountLogin} · {installation.repositorySelection ?? "선택한 저장소"}</p>
            {installations.length > 1 ? <p className="mt-1 text-[11px] text-muted-foreground">설치 {installations.length}개</p> : null}
          </>
        ) : <p className="text-xs text-muted-foreground">설치된 GitHub App이 없습니다.</p>}
      </div>
    </div>
  );
}

function StatusMessage({ children, icon: Icon }: { children: string; icon: LucideIcon }) {
  return <div className="flex min-h-32 items-center justify-center gap-2 rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground"><Icon className="size-4" /><span>{children}</span></div>;
}
