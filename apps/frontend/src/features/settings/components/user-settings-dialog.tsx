"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Check,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Loader2,
  MonitorCog,
  Moon,
  Palette,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  X
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteWorkspace,
  updateWorkspace
} from "@/features/auth/api/client";
import { useAuthSession } from "@/features/auth/auth-session";
import { isDevPreviewAccessToken } from "@/features/auth/session-storage";
import { cn } from "@/lib/utils";
import {
  deleteCurrentAccount,
  updateCurrentProfile,
  updateCurrentSettings
} from "@/features/settings/api/client";
import {
  AVATAR_COLORS,
  type SettingsSectionId
} from "@/features/settings/options";

export type SettingsDialogSectionId =
  | "profile"
  | "account"
  | SettingsSectionId;

export type UserDialogProps = {
  activeWorkspaceName: string;
  avatarUrl: string | null;
  canManageWorkspace: boolean;
  email: string;
  githubContent: ReactNode;
  initialSection?: SettingsDialogSectionId;
  joinedAt: string | null;
  name: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const ACCOUNT_SECTIONS: Array<{
  id: Extract<SettingsDialogSectionId, "profile" | "account">;
  label: string;
  icon: typeof UserRound;
}> = [
  { id: "profile", label: "프로필", icon: UserRound },
  { id: "account", label: "계정", icon: KeyRound }
];

type SettingsNavigationSection = {
  id: SettingsSectionId;
  label: string;
  icon: typeof Settings2;
};

const PERSONAL_SETTINGS_SECTIONS: SettingsNavigationSection[] = [
  { id: "general", label: "일반", icon: LayoutDashboard },
  { id: "appearance", label: "화면", icon: Palette }
];

const CONNECTION_SETTINGS_SECTIONS: SettingsNavigationSection[] = [
  { id: "github", label: "GitHub", icon: GitBranch }
];

const WORKSPACE_SETTINGS_SECTIONS: SettingsNavigationSection[] = [
  { id: "workspace", label: "Workspace", icon: Building2 }
];

const SECTION_COPY: Record<
  SettingsDialogSectionId,
  { title: string; description: string }
> = {
  profile: {
    title: "프로필",
    description: "PILO에서 사용 중인 프로필을 조회합니다."
  },
  account: {
    title: "계정 관리",
    description: "개인 프로필과 계정 수명 주기를 관리합니다."
  },
  general: {
    title: "일반 설정",
    description: "PILO의 기본 동작 방식을 선택하세요."
  },
  appearance: {
    title: "화면 설정",
    description: "PILO의 화면 모양과 정보 밀도를 선택하세요."
  },
  github: {
    title: "GitHub 설정",
    description: "개인 계정과 Workspace의 GitHub 연결을 확인하고 관리하세요."
  },
  workspace: {
    title: "Workspace 설정",
    description: "현재 Workspace의 기본 정보와 관리 작업을 확인하세요."
  }
};

export function SettingsDialog(props: UserDialogProps) {
  return <SettingsView {...props} />;
}

function ProfileView({
  activeWorkspaceName,
  avatarUrl,
  email,
  joinedAt,
  name
}: UserDialogProps) {
  const authSession = useAuthSession();
  const profile = authSession?.user;
  const displayName = profile?.displayName ?? name;
  const profileAvatarUrl = profile?.avatarUrl ?? avatarUrl;
  const jobTitle = profile?.jobTitle;
  const bio = profile?.bio;
  const initials = getInitials(displayName, email);

  return (
    <div className="grid gap-5">
      <Card
        className="scroll-mt-8 rounded-none bg-transparent py-0 ring-0"
        id="profile-summary"
      >
        <CardContent className="flex flex-col gap-5 px-0 sm:flex-row sm:items-center">
          <Avatar className="size-20 ring-4 ring-background shadow-sm">
            <AvatarImage alt={displayName} src={profileAvatarUrl || undefined} />
            <AvatarFallback className="text-xl">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold">{displayName}</h3>
              {jobTitle ? <Badge variant="secondary">{jobTitle}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{email}</p>
            <p className="mt-4 max-w-xl text-sm leading-6">
              {bio ?? "아직 등록된 소개가 없습니다."}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-0">
        <SummaryCard
          icon={<Building2 />}
          label="현재 Workspace"
          value={activeWorkspaceName}
        />
        <SummaryCard
          icon={<CalendarDays />}
          label="PILO 시작일"
          value={formatJoinedAt(joinedAt)}
        />
      </div>

      <Card
        className="scroll-mt-8 rounded-none border-t py-8 ring-0"
        id="profile-details"
      >
        <CardHeader className="px-0">
          <CardTitle>공개 프로필 정보</CardTitle>
          <CardDescription>
            Workspace 멤버와 협업 화면에 표시될 정보입니다.
          </CardDescription>
          <CardAction>
            <Badge variant="outline">조회 전용</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4 px-0 sm:grid-cols-2">
          <ReadonlyField label="표시 이름" value={displayName} />
          <ReadonlyField label="직무" value={jobTitle ?? "등록되지 않음"} />
          <ReadonlyField
            className="sm:col-span-2"
            label="소개"
            value={bio ?? "등록되지 않음"}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function AccountView(props: UserDialogProps) {
  const { avatarUrl, email, joinedAt, name } = props;
  const authSession = useAuthSession();
  const profile = authSession?.user;
  const [displayName, setDisplayName] = useState(profile?.displayName ?? name);
  const [jobTitle, setJobTitle] = useState(profile?.jobTitle ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [avatarMode, setAvatarMode] = useState(
    profile?.avatarMode ?? "provider"
  );
  const [customAvatarUrl, setCustomAvatarUrl] = useState(
    profile?.customAvatarUrl ?? ""
  );
  const [avatarColor, setAvatarColor] = useState(
    profile?.avatarColor ?? "#8B5CF6"
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<
    "idle" | "saving" | "deleting"
  >("idle");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const initials = getInitials(displayName, email);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? name);
    setJobTitle(profile?.jobTitle ?? "");
    setBio(profile?.bio ?? "");
    setAvatarMode(profile?.avatarMode ?? "provider");
    setCustomAvatarUrl(profile?.customAvatarUrl ?? "");
    setAvatarColor(profile?.avatarColor ?? "#8B5CF6");
  }, [name, profile]);

  const handleSaveProfile = async () => {
    if (!authSession) return;
    if (avatarMode === "custom" && !customAvatarUrl.trim()) {
      setNotice("URL 이미지를 사용하려면 HTTPS 이미지 주소를 입력해주세요.");
      return;
    }
    setActionStatus("saving");
    setNotice(null);
    try {
      if (!isDevPreviewAccessToken(authSession.accessToken)) {
        await updateCurrentProfile(authSession.accessToken, {
          displayName: displayName.trim() || null,
          jobTitle: jobTitle.trim() || null,
          bio: bio.trim() || null,
          avatarMode,
          customAvatarUrl: customAvatarUrl.trim() || null,
          avatarColor
        });
        await authSession.refreshSession(authSession.activeWorkspaceId);
      }
      setNotice("프로필이 저장되었습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "프로필을 저장하지 못했습니다."
      );
    } finally {
      setActionStatus("idle");
    }
  };

  const handleDeleteAccount = async () => {
    if (!authSession) return;
    setActionStatus("deleting");
    setNotice(null);
    try {
      if (isDevPreviewAccessToken(authSession.accessToken)) {
        setDeleteOpen(false);
        setNotice("UI Preview에서는 계정을 탈퇴할 수 없습니다.");
        return;
      }
      await deleteCurrentAccount(authSession.accessToken, deleteConfirmation);
      setDeleteOpen(false);
      await authSession.logout();
    } catch (error) {
      setDeleteOpen(false);
      setNotice(
        error instanceof Error ? error.message : "계정을 탈퇴하지 못했습니다."
      );
    } finally {
      setActionStatus("idle");
    }
  };

  return (
    <div className="grid gap-5">
      <Card className="scroll-mt-8 rounded-none py-0 ring-0" id="account-profile">
        <CardContent className="grid gap-5 px-0">
          <div className="flex flex-col gap-4 border-b py-6 sm:flex-row sm:items-center">
            <Avatar className="size-16">
              <AvatarImage
                alt={displayName}
                src={
                  avatarMode === "custom"
                    ? customAvatarUrl.trim() || undefined
                    : avatarMode === "provider"
                      ? profile?.providerAvatarUrl || avatarUrl || undefined
                      : undefined
                }
              />
              <AvatarFallback
                className={
                  AVATAR_COLORS.find((color) => color.id === avatarColor)
                    ?.className
                }
              >
                <span className="text-white">{initials}</span>
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">프로필 이미지</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => setAvatarMode("provider")}
                  size="sm"
                  variant={avatarMode === "provider" ? "default" : "outline"}
                >
                  제공자 이미지
                </Button>
                <Button
                  onClick={() => setAvatarMode("custom")}
                  size="sm"
                  variant={avatarMode === "custom" ? "default" : "outline"}
                >
                  URL 이미지
                </Button>
                <Button
                  onClick={() => setAvatarMode("initials")}
                  size="sm"
                  variant={avatarMode === "initials" ? "default" : "outline"}
                >
                  이니셜
                </Button>
              </div>
              {avatarMode === "custom" ? (
                <Input
                  className="mt-3"
                  onChange={(event) => setCustomAvatarUrl(event.target.value)}
                  placeholder="https://example.com/profile.png"
                  type="url"
                  value={customAvatarUrl}
                />
              ) : null}
            </div>
            {avatarMode === "initials" ? (
              <div className="flex gap-2">
                {AVATAR_COLORS.map((color) => (
                  <Button
                    aria-label={color.label}
                    className={cn(
                      "size-7 rounded-full p-0",
                      color.className,
                      avatarColor === color.id &&
                        "ring-2 ring-ring ring-offset-2"
                    )}
                    key={color.id}
                    onClick={() => setAvatarColor(color.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    {avatarColor === color.id ? (
                      <Check className="size-3 text-white" />
                    ) : null}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="표시 이름">
              <Input
                maxLength={100}
                onChange={(event) => setDisplayName(event.target.value)}
                value={displayName}
              />
            </Field>
            <Field label="직무">
              <Input
                maxLength={100}
                onChange={(event) => setJobTitle(event.target.value)}
                value={jobTitle}
              />
            </Field>
            <Field className="sm:col-span-2" label="소개">
              <Textarea
                maxLength={500}
                onChange={(event) => setBio(event.target.value)}
                value={bio}
              />
              <span className="text-right text-[11px] text-muted-foreground">
                {bio.length}/500
              </span>
            </Field>
          </div>
        </CardContent>
        <CardFooter className="mt-1 justify-between gap-3 rounded-none bg-transparent px-0">
          <p className="text-xs text-muted-foreground" role="status">
            {notice ?? "변경사항을 저장하면 사이드바와 멤버 프로필에 반영됩니다."}
          </p>
          <Button
            disabled={actionStatus !== "idle"}
            onClick={() => void handleSaveProfile()}
          >
            {actionStatus === "saving" ? <Loader2 className="animate-spin" /> : <Save />}
            변경사항 저장
          </Button>
        </CardFooter>
      </Card>

      <Card
        className="scroll-mt-8 rounded-none border-t py-8 ring-0"
        id="account-information"
      >
        <CardHeader className="px-0">
          <CardTitle>계정 정보</CardTitle>
          <CardDescription>인증으로 확인된 읽기 전용 정보입니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-0 sm:grid-cols-2">
          <ReadonlyField label="이메일" value={email} />
          <ReadonlyField
            label="로그인 제공자"
            value={
              profile?.loginProviders
                .map((provider) => (provider === "github" ? "GitHub" : "Google"))
                .join(", ") || "확인되지 않음"
            }
          />
          <ReadonlyField label="가입일" value={formatJoinedAt(joinedAt)} />
        </CardContent>
      </Card>

      <div className="scroll-mt-8" id="account-danger">
        <DangerZone
          description="계정을 탈퇴하면 개인 설정과 세션이 제거됩니다. 소유 중인 Workspace가 있으면 먼저 소유권을 이전하거나 삭제해야 합니다."
          onAction={() => {
            setDeleteConfirmation("");
            setDeleteOpen(true);
          }}
          title="계정 탈퇴"
        />
      </div>

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <AlertTriangle />
            </AlertDialogMedia>
            <AlertDialogTitle>정말 계정을 탈퇴할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이 작업은 되돌릴 수 없습니다. 확인하려면 아래에
              <strong className="text-foreground"> 계정 탈퇴</strong>를 입력하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="계정 탈퇴 확인 문구"
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder="계정 탈퇴"
            value={deleteConfirmation}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleteConfirmation !== "계정 탈퇴" || actionStatus !== "idle"
              }
              onClick={() => void handleDeleteAccount()}
              variant="destructive"
            >
              {actionStatus === "deleting" ? (
                <Loader2 className="animate-spin" />
              ) : null}
              탈퇴 요청
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SettingsView(props: UserDialogProps) {
  const authSession = useAuthSession();
  const {
    activeWorkspaceName,
    avatarUrl,
    canManageWorkspace,
    email,
    githubContent,
    initialSection,
    name,
    onOpenChange,
    open
  } = props;
  const [activeSection, setActiveSection] =
    useState<SettingsDialogSectionId>("general");
  const [defaultWorkspace, setDefaultWorkspace] = useState(
    authSession?.settings.defaultWorkspaceId ?? "none"
  );
  const [defaultLandingPage, setDefaultLandingPage] = useState(
    authSession?.settings.defaultLandingPage ?? "home"
  );
  const [restoreLastWorkspace, setRestoreLastWorkspace] = useState(
    authSession?.settings.restoreLastWorkspace ?? true
  );
  const [theme, setTheme] = useState(
    authSession?.settings.theme ?? "system"
  );
  const [density, setDensity] = useState(
    authSession?.settings.density ?? "comfortable"
  );
  const [workspaceName, setWorkspaceName] = useState(activeWorkspaceName);
  const [workspaceIcon, setWorkspaceIcon] = useState(
    authSession?.activeWorkspace.icon ?? ""
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<
    "idle" | "saving-settings" | "saving-workspace" | "deleting-workspace"
  >("idle");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState<
    string | null
  >(null);
  const sidebarDisplayName = authSession?.user.displayName ?? name;
  const sidebarAvatarUrl = authSession?.user.avatarUrl ?? avatarUrl;
  const initials = getInitials(sidebarDisplayName, email);
  const activeSectionCopy = SECTION_COPY[activeSection];
  const activeGithubContent =
    activeSection === "github" ? githubContent : null;

  useEffect(() => {
    setWorkspaceName(activeWorkspaceName);
    setWorkspaceIcon(authSession?.activeWorkspace.icon ?? "");
  }, [activeWorkspaceName, authSession?.activeWorkspace.icon]);

  useEffect(() => {
    if (open) {
      setActiveSection(initialSection ?? "general");
    }
  }, [initialSection, open]);

  useEffect(() => {
    if (!open || !authSession) return;
    setDefaultWorkspace(authSession.settings.defaultWorkspaceId ?? "none");
    setDefaultLandingPage(authSession.settings.defaultLandingPage);
    setRestoreLastWorkspace(authSession.settings.restoreLastWorkspace);
    setTheme(authSession.settings.theme);
    setDensity(authSession.settings.density);
  }, [authSession, open]);

  const handleSaveSettings = async () => {
    if (!authSession) return;
    setActionStatus("saving-settings");
    setNotice(null);
    try {
      if (!isDevPreviewAccessToken(authSession.accessToken)) {
        await updateCurrentSettings(authSession.accessToken, {
          theme: theme as "system" | "light" | "dark",
          density: density as "comfortable" | "compact",
          defaultWorkspaceId:
            defaultWorkspace === "none" ? null : defaultWorkspace,
          defaultLandingPage: defaultLandingPage as
            | "home"
            | "calendar"
            | "board"
            | "canvas",
          restoreLastWorkspace
        });
        await authSession.refreshSession(authSession.activeWorkspaceId);
      }
      setNotice("설정이 저장되었습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "설정을 저장하지 못했습니다."
      );
    } finally {
      setActionStatus("idle");
    }
  };

  const handleSaveWorkspace = async () => {
    if (!authSession || !canManageWorkspace) return;
    setActionStatus("saving-workspace");
    setNotice(null);
    try {
      if (!isDevPreviewAccessToken(authSession.accessToken)) {
        const workspace = await updateWorkspace(
          authSession.accessToken,
          authSession.activeWorkspaceId,
          { name: workspaceName, icon: workspaceIcon.trim() || null }
        );
        await authSession.refreshSession(workspace.id);
      }
      setNotice("Workspace 정보가 저장되었습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Workspace 정보를 저장하지 못했습니다."
      );
    } finally {
      setActionStatus("idle");
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!authSession || !canManageWorkspace) return;
    setActionStatus("deleting-workspace");
    setNotice(null);
    setWorkspaceDeleteError(null);
    try {
      if (isDevPreviewAccessToken(authSession.accessToken)) {
        setNotice("UI Preview에서는 Workspace를 삭제할 수 없습니다.");
        setDeleteOpen(false);
        return;
      }
      await deleteWorkspace(
        authSession.accessToken,
        authSession.activeWorkspaceId,
        deleteConfirmation
      );
      setDeleteOpen(false);
      const nextWorkspace = authSession.workspaces.find(
        (workspace) => workspace.id !== authSession.activeWorkspaceId
      );
      if (!nextWorkspace) {
        window.location.assign("/workspace/new?onboarding=1");
        return;
      }
      await authSession.refreshSession(nextWorkspace.id);
      onOpenChange(false);
    } catch (error) {
      setWorkspaceDeleteError(
        error instanceof Error ? error.message : "Workspace를 삭제하지 못했습니다."
      );
    } finally {
      setActionStatus("idle");
    }
  };

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-xs text-muted-foreground" role="status">
        {notice ?? "변경사항은 현재 사용자 설정으로 저장됩니다."}
      </p>
      <Button
        disabled={actionStatus !== "idle"}
        onClick={() => void handleSaveSettings()}
      >
        {actionStatus === "saving-settings" ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Save />
        )}
        설정 저장
      </Button>
    </div>
  );

  const workspaceFooter = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-xs text-muted-foreground" role="status">
        {notice ?? "Owner만 Workspace 정보를 변경할 수 있습니다."}
      </p>
      <Button
        disabled={!canManageWorkspace || actionStatus !== "idle"}
        onClick={() => void handleSaveWorkspace()}
      >
        {actionStatus === "saving-workspace" ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Save />
        )}
        Workspace 저장
      </Button>
    </div>
  );

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent
          className="h-[calc(100vh-3rem)] max-h-[44rem] w-[calc(100vw-3rem)] max-w-6xl gap-0 overflow-hidden rounded-xl border-0 bg-background p-0 shadow-2xl"
          showCloseButton={false}
        >
          <Button
            aria-label="닫기"
            className="absolute right-3 top-3 z-20 border-0 bg-transparent shadow-none"
            onClick={() => onOpenChange(false)}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
          <Tabs
            className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-0 md:grid-cols-[16rem_minmax(0,1fr)] md:grid-rows-1"
            onValueChange={(value) => {
              setActiveSection(value as SettingsDialogSectionId);
              setNotice(null);
            }}
            orientation="vertical"
            value={activeSection}
          >
            <aside className="flex min-h-0 flex-col bg-muted px-3 py-4 md:py-5">
              <p className="px-3 text-xs font-medium text-muted-foreground">계정</p>
              <div className="mt-3 hidden items-center gap-2 px-3 py-2 md:flex">
                <Avatar size="sm">
                  <AvatarImage
                    alt={sidebarDisplayName}
                    src={sidebarAvatarUrl || undefined}
                  />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {sidebarDisplayName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{email}</p>
                </div>
              </div>

              <TabsList className="mt-2 grid h-auto w-full grid-cols-3 gap-0.5 bg-transparent p-0 md:flex md:items-stretch">
                {ACCOUNT_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <TabsTrigger
                      className="h-9 min-w-0 justify-start border-0 px-3 font-normal shadow-none data-active:bg-muted data-active:shadow-none!"
                      key={section.id}
                      value={section.id}
                    >
                      <Icon /> {section.label}
                    </TabsTrigger>
                  );
                })}
                <p className="col-span-3 mt-2 hidden px-3 pb-1 text-xs font-medium text-muted-foreground md:block">
                  개인 설정
                </p>
                {PERSONAL_SETTINGS_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <TabsTrigger
                      className="h-9 min-w-0 justify-start border-0 px-3 font-normal shadow-none data-active:bg-muted data-active:shadow-none!"
                      key={section.id}
                      value={section.id}
                    >
                      <Icon /> {section.label}
                    </TabsTrigger>
                  );
                })}
                <p className="col-span-3 mt-5 hidden px-3 pb-1 text-xs font-medium text-muted-foreground md:block">
                  연결
                </p>
                {CONNECTION_SETTINGS_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <TabsTrigger
                      className="h-9 min-w-0 justify-start border-0 px-3 font-normal shadow-none data-active:bg-muted data-active:shadow-none!"
                      key={section.id}
                      value={section.id}
                    >
                      <Icon /> {section.label}
                    </TabsTrigger>
                  );
                })}
                <p className="col-span-3 mt-5 hidden px-3 pb-1 text-xs font-medium text-muted-foreground md:block">
                  Workspace
                </p>
                {WORKSPACE_SETTINGS_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <TabsTrigger
                      className="h-9 min-w-0 justify-start border-0 px-3 font-normal shadow-none data-active:bg-muted data-active:shadow-none!"
                      key={section.id}
                      value={section.id}
                    >
                      <Icon /> {section.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              <div className="mt-auto hidden px-3 md:block">
                <Badge className="font-normal text-muted-foreground" variant="outline">
                  <Sparkles />
                  {authSession && isDevPreviewAccessToken(authSession.accessToken)
                    ? "UI Preview"
                    : "API 연결됨"}
                </Badge>
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto bg-background">
              <div
                className={cn(
                  "mx-auto w-full max-w-5xl px-6 pb-20 pt-10 sm:px-10 lg:px-14 lg:pt-14",
                  activeSection === "github" &&
                    "max-w-none px-4 pb-8 pt-8 sm:px-5 lg:px-6 lg:pt-10"
                )}
              >
                <DialogHeader className="pr-10">
                  <DialogTitle className="text-3xl font-semibold tracking-tight">
                    {activeSectionCopy.title}
                  </DialogTitle>
                  <DialogDescription className="mt-2 text-base text-foreground/80">
                    {activeSectionCopy.description}
                  </DialogDescription>
                </DialogHeader>

                <div
                  className={cn(
                    "mt-12",
                    activeSection === "github" && "mt-8"
                  )}
                >

        <TabsContent value="profile">
          <ProfileView {...props} />
        </TabsContent>

        <TabsContent value="account">
          <AccountView {...props} />
        </TabsContent>

        <TabsContent value="general">
          <SettingsPanel
            description="PILO를 열었을 때 가장 먼저 보이는 작업 환경을 정합니다."
            title="시작 환경"
          >
            <SettingRow
              description="로그인 후 기본으로 선택할 Workspace입니다."
              label="기본 Workspace"
            >
              <Select
                onValueChange={(value) => setDefaultWorkspace(value ?? "none")}
                value={defaultWorkspace}
              >
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue>
                    {defaultWorkspace === "none"
                      ? "자동 선택"
                      : authSession?.workspaces.find(
                            (workspace) => workspace.id === defaultWorkspace
                          )?.name ?? "자동 선택"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">자동 선택</SelectItem>
                  {authSession?.workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow
              description="Workspace 진입 시 처음 열릴 화면입니다."
              label="시작 화면"
            >
              <Select
                onValueChange={(value) => setDefaultLandingPage(value ?? "home")}
                value={defaultLandingPage}
              >
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue>
                    {{
                      home: "Home",
                      board: "Board",
                      canvas: "Canvas",
                      calendar: "Calendar"
                    }[defaultLandingPage] ?? "Home"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="board">Board</SelectItem>
                  <SelectItem value="canvas">Canvas</SelectItem>
                  <SelectItem value="calendar">Calendar</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow
              description="다음 로그인 때 마지막으로 사용한 Workspace를 우선 복원합니다."
              label="마지막 Workspace 복원"
            >
              <Switch
                checked={restoreLastWorkspace}
                onCheckedChange={setRestoreLastWorkspace}
              />
            </SettingRow>
            {footer}
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="appearance">
          <SettingsPanel
            description="테마와 화면 밀도를 내 작업 방식에 맞게 선택합니다."
            title="테마와 화면 밀도"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                { id: "light", label: "라이트", icon: Sun },
                { id: "dark", label: "다크", icon: Moon },
                { id: "system", label: "시스템", icon: MonitorCog }
              ] as const).map((option) => {
                const Icon = option.icon;
                return (
                  <Button
                    className="h-24 flex-col gap-2"
                    key={option.id}
                    onClick={() => setTheme(option.id)}
                    variant={theme === option.id ? "default" : "outline"}
                  >
                    <Icon className="size-5" />
                    {option.label}
                  </Button>
                );
              })}
            </div>
            <SettingRow
              description="목록과 카드 사이의 간격을 조절합니다."
              label="화면 밀도"
            >
              <div className="flex gap-2">
                <Button
                  onClick={() => setDensity("comfortable")}
                  variant={density === "comfortable" ? "default" : "outline"}
                >
                  편안하게
                </Button>
                <Button
                  onClick={() => setDensity("compact")}
                  variant={density === "compact" ? "default" : "outline"}
                >
                  조밀하게
                </Button>
              </div>
            </SettingRow>
            {footer}
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="github">
          {activeGithubContent ? (
            <GithubSettingsContent githubContent={activeGithubContent} />
          ) : null}
        </TabsContent>

        <TabsContent value="workspace">
          <SettingsPanel
            description="현재 Workspace의 기본 정보와 수명 주기를 관리합니다."
            title="Workspace 정보"
          >
            <Card className="ring-0">
              <CardHeader>
                <CardTitle>{activeWorkspaceName}</CardTitle>
                <CardDescription>
                  {canManageWorkspace
                    ? "Owner 권한으로 수정할 수 있습니다."
                    : "Member는 Workspace 정보를 조회만 할 수 있습니다."}
                </CardDescription>
                <CardAction>
                  <Badge variant={canManageWorkspace ? "secondary" : "outline"}>
                    {canManageWorkspace ? "Owner" : "Member"}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-[5rem_1fr] sm:items-end">
                <Field label="아이콘">
                  <Input
                    disabled={!canManageWorkspace}
                    maxLength={2}
                    onChange={(event) => setWorkspaceIcon(event.target.value)}
                    value={workspaceIcon}
                  />
                </Field>
                <Field label="Workspace 이름">
                  <Input
                    disabled={!canManageWorkspace}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    value={workspaceName}
                  />
                </Field>
              </CardContent>
            </Card>

            {canManageWorkspace ? (
              <DangerZone
                description="Workspace의 보드, 일정, 회의, Canvas 데이터가 함께 제거됩니다. 삭제 전 연결 상태와 진행 중인 작업을 검사합니다."
                onAction={() => {
                  setDeleteConfirmation("");
                  setWorkspaceDeleteError(null);
                  setDeleteOpen(true);
                }}
                title="Workspace 삭제"
              />
            ) : (
              <Card className="border-dashed ring-0">
                <CardContent className="flex items-start gap-3 text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4" />
                  <p className="text-sm">
                    이름·아이콘 변경과 Workspace 삭제는 Owner만 사용할 수 있습니다.
                  </p>
                </CardContent>
              </Card>
            )}
            {workspaceFooter}
          </SettingsPanel>
        </TabsContent>

                </div>
              </div>
            </main>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(nextOpen) => {
          setDeleteOpen(nextOpen);
          if (!nextOpen) setWorkspaceDeleteError(null);
        }}
        open={deleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{activeWorkspaceName}을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이 작업은 되돌릴 수 없습니다. 확인하려면 Workspace 이름을 정확히 입력하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Workspace 삭제 확인 이름"
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder={activeWorkspaceName}
            value={deleteConfirmation}
          />
          {workspaceDeleteError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {workspaceDeleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleteConfirmation !== activeWorkspaceName ||
                actionStatus !== "idle"
              }
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteWorkspace();
              }}
              variant="destructive"
            >
              {actionStatus === "deleting-workspace" ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Workspace 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function GithubSettingsContent({
  githubContent
}: Pick<UserDialogProps, "githubContent">) {
  return <>{githubContent}</>;
}

function SummaryCard({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-none border-b bg-transparent py-5 ring-0" size="sm">
      <CardContent className="flex items-start gap-3 px-0">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 truncate font-medium">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  children,
  className,
  label
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={cn("grid gap-1.5 text-sm font-medium", className)}>
      {label}
      {children}
    </label>
  );
}

function ReadonlyField({
  className,
  label,
  value
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="break-words rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        {value}
      </p>
    </div>
  );
}

function SettingsPanel({
  children,
  description,
  title
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="grid gap-0">
      <div className="border-b pb-4">
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function SettingRow({
  children,
  description,
  label
}: {
  children: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <Card className="rounded-none border-b py-6 ring-0" size="sm">
      <CardContent className="flex flex-col gap-4 px-0 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">{label}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="shrink-0">{children}</div>
      </CardContent>
    </Card>
  );
}

function DangerZone({
  description,
  onAction,
  title
}: {
  description: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <Card className="border border-destructive/30 ring-0">
      <CardHeader>
        <CardTitle className="text-destructive">위험 영역</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardFooter className="justify-between gap-3 border-destructive/20 bg-destructive/5">
        <p className="text-sm font-medium">{title}</p>
        <Button onClick={onAction} variant="destructive">
          <Trash2 /> {title}
        </Button>
      </CardFooter>
    </Card>
  );
}

function getInitials(name: string, email: string) {
  const source = name.trim() || email.trim() || "PILO";
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "P"
  );
}

function formatJoinedAt(value: string | null) {
  if (!value) {
    return "확인되지 않음";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "확인되지 않음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}
