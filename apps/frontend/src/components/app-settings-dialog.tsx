"use client";

import { useState, type ReactNode } from "react";
import {
  Building2,
  CheckCircle2,
  GitBranch,
  KeyRound,
  Laptop,
  ShieldCheck,
  UserRound,
  type LucideIcon
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AppSettingsDialogProps = {
  activeWorkspaceName: string;
  canManageWorkspace: boolean;
  email: string;
  name: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

type SettingsTabId = "account" | "github" | "workspace" | "security";

const SETTINGS_TABS: Array<{
  description: string;
  icon: LucideIcon;
  id: SettingsTabId;
  label: string;
}> = [
  {
    description: "프로필과 계정 정보",
    icon: UserRound,
    id: "account",
    label: "내 계정"
  },
  {
    description: "현재 워크스페이스의 GitHub 연동",
    icon: GitBranch,
    id: "github",
    label: "GitHub 연결"
  },
  {
    description: "현재 워크스페이스 설정",
    icon: Building2,
    id: "workspace",
    label: "워크스페이스 관리"
  },
  {
    description: "로그인과 활성 세션",
    icon: ShieldCheck,
    id: "security",
    label: "보안 및 세션"
  }
];

const MOCK_GITHUB_CONNECTIONS = [
  {
    id: "github-user",
    name: "GitHub 사용자 연결",
    account: "donghyun-pilo",
    description: "PR Review와 GitHub App 사용자 인증",
    connectedAt: "2026. 7. 2.",
    icon: GitBranch
  },
  {
    id: "github-app",
    name: "GitHub App 설치",
    account: "pilo-team · selected repositories",
    description: "Repository, Issue, PR 원본 동기화",
    connectedAt: "2026. 7. 4.",
    icon: GitBranch
  },
  {
    id: "github-project",
    name: "GitHub Project OAuth",
    account: "project scope 연결됨",
    description: "개인 ProjectV2 조회와 상태 변경",
    connectedAt: "2026. 7. 8.",
    icon: KeyRound
  }
];

const MOCK_SESSIONS = [
  {
    id: "current-session",
    device: "Windows · Chrome",
    location: "Seoul, South Korea",
    lastUsedAt: "방금 전",
    expiresAt: "2026. 8. 10.",
    current: true
  },
  {
    id: "secondary-session",
    device: "macOS · Safari",
    location: "Seoul, South Korea",
    lastUsedAt: "2일 전",
    expiresAt: "2026. 8. 5.",
    current: false
  }
];

export function AppSettingsDialog({
  activeWorkspaceName,
  canManageWorkspace,
  email,
  name,
  onOpenChange,
  open
}: AppSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("account");
  const [displayName, setDisplayName] = useState(name);
  const [mockNotice, setMockNotice] = useState<string | null>(null);
  const activeTabMetadata =
    SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0];
  const initials = getInitials(displayName, email);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setMockNotice(null);
    }

    onOpenChange(nextOpen);
  }

  function showMockNotice(message: string) {
    setMockNotice(`${message} 현재는 목업 동작입니다.`);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <div className="flex min-h-[34rem] flex-col sm:flex-row">
          <aside className="shrink-0 border-b bg-muted/25 p-3 sm:w-52 sm:border-b-0 sm:border-r">
            <div className="hidden px-2 pb-4 pt-1 sm:block">
              <p className="text-sm font-semibold">설정</p>
              <p className="mt-1 text-xs text-muted-foreground">PILO 환경 설정</p>
            </div>

            <nav
              aria-label="설정 메뉴"
              className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible"
            >
              {SETTINGS_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors sm:w-full",
                      isActive
                        ? "bg-background font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                    )}
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setMockNotice(null);
                    }}
                    type="button"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <DialogHeader className="border-b px-6 py-5">
              <DialogTitle>{activeTabMetadata.label}</DialogTitle>
              <DialogDescription>
                {activeTabMetadata.description}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {activeTab === "account" ? (
                <SettingsPage
                  description="사용자 테이블에 저장되는 기본 프로필 정보입니다."
                  title="프로필"
                >
                  <div className="flex items-center gap-4 rounded-lg border p-4">
                    <Avatar size="lg">
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {email}
                      </p>
                    </div>
                    <Button
                      onClick={() => showMockNotice("프로필 이미지 변경을 선택했습니다.")}
                      size="sm"
                      variant="outline"
                    >
                      이미지 변경
                    </Button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-medium">
                      이름
                      <Input
                        onChange={(event) => setDisplayName(event.target.value)}
                        value={displayName}
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-medium">
                      이메일
                      <Input disabled value={email} />
                    </label>
                    <label className="grid gap-1.5 text-sm font-medium">
                      가입일
                      <Input disabled value="2026. 6. 12." />
                    </label>
                  </div>
                </SettingsPage>
              ) : null}

              {activeTab === "github" ? (
                <SettingsPage
                  description={
                    canManageWorkspace
                      ? "현재 Workspace의 GitHub 연결을 확인하고 관리합니다."
                      : "현재 Workspace의 GitHub 연결 상태를 조회할 수 있습니다. 변경은 Owner만 가능합니다."
                  }
                  title={`${activeWorkspaceName} GitHub 연결`}
                >
                  <div className="grid gap-2">
                    {MOCK_GITHUB_CONNECTIONS.map((connection) => {
                      const Icon = connection.icon;

                      return (
                        <div
                          className="flex items-center gap-3 rounded-lg border p-3"
                          key={connection.id}
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                {connection.name}
                              </p>
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                                <CheckCircle2 className="size-3" /> 연결됨
                              </span>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {connection.account}
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {connection.description} · {connection.connectedAt}
                            </p>
                          </div>
                          <Button
                            disabled={!canManageWorkspace}
                            onClick={() =>
                              showMockNotice(`${connection.name} 관리를 선택했습니다.`)
                            }
                            size="sm"
                            variant="outline"
                          >
                            {canManageWorkspace ? "연결 관리" : "조회 전용"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </SettingsPage>
              ) : null}

              {activeTab === "workspace" ? (
                canManageWorkspace ? (
                  <SettingsPage
                    description="현재 선택된 워크스페이스의 관리 설정입니다. 실제 저장은 후속 API 연결에서 제공됩니다."
                    title={`${activeWorkspaceName} 관리`}
                  >
                    <div className="grid gap-4 rounded-lg border p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Building2 className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {activeWorkspaceName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Owner 권한 · 관리 가능
                          </p>
                        </div>
                      </div>

                      <label className="grid gap-1.5 text-sm font-medium">
                        워크스페이스 이름
                        <Input disabled value={activeWorkspaceName} />
                      </label>
                    </div>

                  </SettingsPage>
                ) : (
                  <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
                    <ShieldCheck className="size-8 text-muted-foreground" />
                    <p className="mt-3 text-sm font-semibold">Owner 전용 설정입니다.</p>
                    <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                      {activeWorkspaceName}의 Workspace 설정과 GitHub 연결은 Owner만
                      관리할 수 있습니다.
                    </p>
                  </div>
                )
              ) : null}

              {activeTab === "security" ? (
                <SettingsPage
                  description="로그인된 기기와 세션 만료 정보를 확인합니다."
                  title="활성 세션"
                >
                  <div className="grid gap-2">
                    {MOCK_SESSIONS.map((session) => (
                      <div
                        className="flex items-center gap-3 rounded-lg border p-3"
                        key={session.id}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Laptop className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {session.device}
                            </p>
                            {session.current ? (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                                현재 세션
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {session.location} · 마지막 사용 {session.lastUsedAt}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            만료 예정 {session.expiresAt}
                          </p>
                        </div>
                        <Button
                          onClick={() => showMockNotice("세션 로그아웃을 선택했습니다.")}
                          size="sm"
                          variant="outline"
                        >
                          로그아웃
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      onClick={() => showMockNotice("다른 세션 로그아웃을 선택했습니다.")}
                      variant="destructive"
                    >
                      다른 모든 세션 로그아웃
                    </Button>
                  </div>
                </SettingsPage>
              ) : null}
            </div>

            <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
              <p className="text-xs text-muted-foreground" role="status">
                {mockNotice ?? "현재 설정 데이터와 동작은 목업입니다."}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => handleOpenChange(false)}
                  variant="outline"
                >
                  닫기
                </Button>
                {activeTab === "account" ? (
                  <Button onClick={() => showMockNotice("계정 저장을 요청했습니다.")}>
                    변경사항 저장
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPage({
  children,
  description,
  title
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="grid gap-5">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function getInitials(name: string, email: string) {
  const source = name.trim() || email.trim() || "PILO";
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "P";
}
