"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Loader2,
  Package,
  PanelsTopLeft,
  Sparkles,
  TriangleAlert
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createWorkspace, listWorkspaces } from "@/features/auth/api/client";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  isDevPreviewAccessToken,
  saveSelectedWorkspaceId
} from "@/features/auth/session-storage";
import {
  WorkspaceCenteredStatus,
  WorkspaceSelectionCard,
  WorkspaceSkippedStep,
  WorkspaceStepIndicator
} from "@/features/workspace-onboarding/components/workspace-onboarding-primitives";
import {
  ICON_OPTIONS,
  MOCK_PROJECTS,
  MOCK_REPOSITORIES,
  WORKSPACE_ONBOARDING_STEPS
} from "@/features/workspace-onboarding/mock-data";

type PageStatus = "checking" | "ready" | "submitting" | "error";

export function WorkspaceCreationPage() {
  const router = useRouter();
  const [status, setStatus] = useState<PageStatus>("checking");
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceIcon, setWorkspaceIcon] = useState<string | null>(null);
  const [connectGithub, setConnectGithub] = useState<boolean | null>(null);
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [hasExistingWorkspace, setHasExistingWorkspace] = useState(false);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const normalizedName = workspaceName.trim();
  const fallbackIcon = normalizedName.slice(0, 1).toUpperCase() || "W";
  const displayIcon = workspaceIcon ?? fallbackIcon;
  const selectedRepository = MOCK_REPOSITORIES.find(
    (repository) => repository.id === repositoryId
  );
  const selectedProject = MOCK_PROJECTS.find(
    (project) => project.id === projectId
  );
  const canContinue = useMemo(() => {
    if (step === 0) return normalizedName.length > 0 && normalizedName.length <= 100;
    if (step === 2) return connectGithub !== null;
    if (step === 3) return connectGithub === false || repositoryId !== null;
    if (step === 4) return connectGithub === false || projectId !== null;
    return true;
  }, [connectGithub, normalizedName, projectId, repositoryId, step]);

  useEffect(() => {
    const storedSession = getStoredAuthSession();
    if (!storedSession) {
      router.replace("/login");
      return;
    }

    if (isDevPreviewAccessToken(storedSession.accessToken)) {
      setHasExistingWorkspace(true);
      setStatus("ready");
      return;
    }

    let cancelled = false;
    void listWorkspaces(storedSession.accessToken)
      .then((workspaces) => {
        if (!cancelled) {
          setHasExistingWorkspace(workspaces.length > 0);
          setStatus("ready");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "워크스페이스 정보를 확인하지 못했습니다."
          );
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (status !== "ready" && status !== "submitting") return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const handlePopState = () => {
      window.history.pushState({ piloWorkspaceWizard: true }, "", window.location.href);
      setShowExitWarning(true);
    };

    window.history.pushState({ piloWorkspaceWizard: true }, "", window.location.href);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [status]);

  function handleBack() {
    if (step > 0) {
      setStep((currentStep) => currentStep - 1);
      return;
    }
    setShowExitWarning(true);
  }

  function handleNext() {
    if (!canContinue) return;
    if (step < WORKSPACE_ONBOARDING_STEPS.length - 1) {
      setStep((currentStep) => currentStep + 1);
      return;
    }
    void handleCreateWorkspace();
  }

  async function handleCreateWorkspace() {
    const storedSession = getStoredAuthSession();
    if (!storedSession) {
      router.replace("/login");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      if (!isDevPreviewAccessToken(storedSession.accessToken)) {
        const workspace = await createWorkspace(storedSession.accessToken, {
          icon: workspaceIcon,
          name: normalizedName
        });
        saveSelectedWorkspaceId(workspace.id);
      }

      router.replace("/home");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "워크스페이스를 만들지 못했습니다."
      );
      setStatus("ready");
    }
  }

  function handleConfirmExit() {
    setShowExitWarning(false);
    if (!hasExistingWorkspace) {
      clearStoredAuthSession();
      router.replace("/login");
      return;
    }
    router.replace("/home");
  }

  if (status === "checking") {
    return <WorkspaceCenteredStatus icon={<Loader2 className="animate-spin" />} text="세션과 워크스페이스를 확인하는 중입니다." />;
  }

  if (status === "error") {
    return (
      <WorkspaceCenteredStatus
        icon={<TriangleAlert />}
        text={errorMessage ?? "워크스페이스 정보를 확인하지 못했습니다."}
        action={<Button onClick={() => router.replace("/login")}>로그인으로 이동</Button>}
      />
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto grid w-full max-w-5xl gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
              {displayIcon}
            </div>
            <div>
              <p className="font-semibold">PILO</p>
              <p className="text-sm text-muted-foreground">새 워크스페이스 만들기</p>
            </div>
          </div>
          <Button onClick={() => setShowExitWarning(true)} variant="ghost">
            나가기
          </Button>
        </header>

        <WorkspaceStepIndicator
          currentStep={step}
          steps={WORKSPACE_ONBOARDING_STEPS}
        />

        <Card className="mx-auto w-full max-w-3xl shadow-sm">
          <CardHeader className="border-b px-6 py-6 sm:px-8">
            <p className="text-sm font-medium text-primary">{step + 1} / {WORKSPACE_ONBOARDING_STEPS.length}</p>
            <CardTitle className="text-2xl">{WORKSPACE_ONBOARDING_STEPS[step].title}</CardTitle>
            <CardDescription>{WORKSPACE_ONBOARDING_STEPS[step].description}</CardDescription>
          </CardHeader>
          <CardContent className="min-h-80 px-6 py-8 sm:px-8">
            {step === 0 ? (
              <div className="grid gap-3">
                <label className="text-sm font-medium" htmlFor="workspace-name">워크스페이스 이름</label>
                <Input
                  autoFocus
                  id="workspace-name"
                  maxLength={100}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="예: PILO Product Team"
                  value={workspaceName}
                />
                <p className="text-sm text-muted-foreground">팀이나 프로젝트를 알아보기 쉬운 이름을 입력해주세요.</p>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="grid gap-5">
                <div className="flex items-center gap-4 rounded-xl border bg-muted/30 p-4">
                  <div className="flex size-14 items-center justify-center rounded-xl bg-primary text-2xl font-semibold text-primary-foreground">{displayIcon}</div>
                  <div>
                    <p className="font-medium">{normalizedName}</p>
                    <p className="text-sm text-muted-foreground">선택하지 않으면 이름의 첫 글자를 사용합니다.</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
                  <Button
                    aria-label="이름 첫 글자 사용"
                    className="h-12 text-lg"
                    onClick={() => setWorkspaceIcon(null)}
                    variant={workspaceIcon === null ? "default" : "outline"}
                  >
                    {fallbackIcon}
                  </Button>
                  {ICON_OPTIONS.map((icon) => (
                    <Button
                      aria-label={`${icon} 아이콘 사용`}
                      className="h-12 text-lg"
                      key={icon}
                      onClick={() => setWorkspaceIcon(icon)}
                      variant={workspaceIcon === icon ? "default" : "outline"}
                    >
                      {icon}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <WorkspaceSelectionCard
                  description="저장소와 ProjectV2를 선택하는 목업 단계를 진행합니다."
                  icon={<GitBranch />}
                  onClick={() => setConnectGithub(true)}
                  selected={connectGithub === true}
                  title="GitHub 연결 설정"
                />
                <WorkspaceSelectionCard
                  description="지금은 건너뛰고 설정의 GitHub 연결 탭에서 다시 시작합니다."
                  icon={<ArrowRight />}
                  onClick={() => {
                    setConnectGithub(false);
                    setRepositoryId(null);
                    setProjectId(null);
                  }}
                  selected={connectGithub === false}
                  title="나중에 연결"
                />
              </div>
            ) : null}

            {step === 3 ? (
              connectGithub ? (
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground">목업 저장소입니다. 실제 GitHub API에는 연결하지 않습니다.</p>
                  {MOCK_REPOSITORIES.map((repository) => (
                    <WorkspaceSelectionCard
                      description={repository.description}
                      icon={<Package />}
                      key={repository.id}
                      onClick={() => setRepositoryId(repository.id)}
                      selected={repositoryId === repository.id}
                      title={repository.name}
                    />
                  ))}
                </div>
              ) : <WorkspaceSkippedStep icon={<GitBranch />} text="GitHub 연결을 건너뛰었습니다. 설정에서 언제든 다시 시작할 수 있습니다." />
            ) : null}

            {step === 4 ? (
              connectGithub ? (
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground">목업 프로젝트입니다. 선택값은 서버에 저장되지 않습니다.</p>
                  {MOCK_PROJECTS.map((project) => (
                    <WorkspaceSelectionCard
                      description={project.description}
                      icon={<PanelsTopLeft />}
                      key={project.id}
                      onClick={() => setProjectId(project.id)}
                      selected={projectId === project.id}
                      title={project.name}
                    />
                  ))}
                  <div className="mt-3 rounded-xl border bg-muted/30 p-4 text-sm">
                    <p className="font-medium">생성 요약</p>
                    <p className="mt-1 text-muted-foreground">{displayIcon} {normalizedName} · {selectedRepository?.name} · {selectedProject?.name ?? "프로젝트 선택 전"}</p>
                  </div>
                </div>
              ) : <WorkspaceSkippedStep icon={<Sparkles />} text="GitHub 단계 없이 워크스페이스를 생성할 준비가 되었습니다." />
            ) : null}

            {errorMessage ? <p className="mt-5 text-sm text-destructive">{errorMessage}</p> : null}
          </CardContent>
          <CardFooter className="justify-between gap-3 px-6 py-4 sm:px-8">
            <Button disabled={status === "submitting"} onClick={handleBack} variant="outline">
              <ArrowLeft /> 이전
            </Button>
            <Button disabled={!canContinue || status === "submitting"} onClick={handleNext}>
              {status === "submitting" ? <Loader2 className="animate-spin" /> : null}
              {status === "submitting" ? "생성 중" : step === WORKSPACE_ONBOARDING_STEPS.length - 1 ? "워크스페이스 생성" : "다음"}
              {status !== "submitting" && step < WORKSPACE_ONBOARDING_STEPS.length - 1 ? <ArrowRight /> : null}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <AlertDialog onOpenChange={setShowExitWarning} open={showExitWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia><TriangleAlert /></AlertDialogMedia>
            <AlertDialogTitle>워크스페이스 만들기를 종료할까요?</AlertDialogTitle>
            <AlertDialogDescription>입력한 이름과 GitHub 선택 내용이 저장되지 않고 사라질 수 있습니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 만들기</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmExit} variant="destructive">나가기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
