"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GitBranch, Loader2, PanelsTopLeft, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createWorkspace } from "@/features/auth/api/client";
import { getStoredAuthSession, saveSelectedWorkspaceId } from "@/features/auth/session-storage";
import { createGithubIntegrationApiClient } from "@/features/github-integration/api/client";
import { WorkspaceCenteredStatus, WorkspaceSelectionCard } from "@/features/workspace-onboarding/components/workspace-onboarding-primitives";
import { createGithubOnboardingReturnUrl, getGithubCallbackErrorMessage, readGithubOnboardingCallback } from "@/features/workspace-onboarding/github-onboarding";
import { ICON_OPTIONS } from "@/features/workspace-onboarding/mock-data";

type Stage = "create" | "github" | "installation" | "syncing" | "project-oauth" | "repositories" | "projects";

export function WorkspaceCreationPage() {
  return <Suspense fallback={<WorkspaceCenteredStatus icon={<Loader2 className="animate-spin" />} text="workspace를 준비하는 중입니다." />}><WorkspaceCreationPageContent /></Suspense>;
}

function WorkspaceCreationPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callback = useMemo(() => readGithubOnboardingCallback(new URLSearchParams(searchParams.toString())), [searchParams]);
  const session = getStoredAuthSession();
  const api = useMemo(() => createGithubIntegrationApiClient({ accessToken: session?.accessToken }), [session?.accessToken]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceIcon, setWorkspaceIcon] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(callback.workspaceId);
  const [installationId, setInstallationId] = useState<string | null>(callback.installationId);
  const [stage, setStage] = useState<Stage>(callback.workspaceId ? callback.step === "project-oauth" ? callback.callbackError ? "project-oauth" : callback.repositoryId ? "projects" : "repositories" : "installation" : "create");
  const [repositories, setRepositories] = useState<Awaited<ReturnType<typeof api.listGithubRepositories>>["data"]>([]);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof api.discoverGithubProjectV2>>["projects"]>([]);
  const [repositoryId, setRepositoryId] = useState<string | null>(callback.repositoryId);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(getGithubCallbackErrorMessage(callback.callbackError));

  useEffect(() => {
    if (!session) router.replace("/login");
  }, [router, session]);

  useEffect(() => {
    if (!workspaceId || callback.callbackError || callback.step !== "oauth") return;
    void resumeGithub(workspaceId);
  // The callback query is intentionally consumed only through github-onboarding.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, callback.callbackError, callback.step]);

  useEffect(() => {
    if (!workspaceId || !installationId || !repositoryId || callback.callbackError || callback.step !== "project-oauth") return;
    void chooseRepository(repositoryId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, installationId, repositoryId, callback.callbackError, callback.step]);

  useEffect(() => {
    if (!workspaceId || !installationId || stage !== "installation") return;
    setStage("syncing");
  }, [installationId, stage, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !installationId || stage !== "syncing") return;
    let stopped = false;
    const check = async () => {
      try {
        const runs = await api.listGithubSyncRuns(workspaceId, { target: "source", limit: 20 });
        const run = runs.data.find((item) => item.installationId === installationId);
        if (!run || run.status === "queued" || run.status === "running") return;
        if (run.status === "failed") {
          if (!stopped) setMessage(run.errorMessage ?? "GitHub source sync에 실패했습니다. 설치를 다시 연결해 주세요.");
          return;
        }
        if (!stopped) setStage("project-oauth");
      } catch (error) { if (!stopped) setMessage(error instanceof Error ? error.message : "GitHub 상태를 확인하지 못했습니다."); }
    };
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [api, installationId, stage, workspaceId]);

  useEffect(() => {
    if (!workspaceId || stage !== "repositories") return;
    void api.listGithubRepositories(workspaceId, { limit: 100 }).then((result) => setRepositories(result.data)).catch((error) => setMessage(error instanceof Error ? error.message : "repository를 조회하지 못했습니다."));
  }, [api, stage, workspaceId]);

  async function resumeGithub(existingWorkspaceId: string) {
    const oauth = await api.getGithubOAuthStatus();
    if (!oauth.connected) {
      const start = await api.startGithubOAuth({ returnUrl: createGithubOnboardingReturnUrl(existingWorkspaceId, "oauth") });
      window.location.assign(start.authorizeUrl); return;
    }
    const install = await api.startGithubAppInstallation(existingWorkspaceId, { returnUrl: createGithubOnboardingReturnUrl(existingWorkspaceId, "installation") });
    window.location.assign(install.installUrl);
  }

  async function createAndConnect(connect: boolean) {
    if (!session || !workspaceName.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const workspace = await createWorkspace(session.accessToken, { name: workspaceName.trim(), icon: workspaceIcon });
      saveSelectedWorkspaceId(workspace.id); setWorkspaceId(workspace.id);
      if (!connect) { router.replace("/home"); return; }
      await resumeGithub(workspace.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "workspace를 만들지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function chooseRepository(id: string) {
    if (!workspaceId || !installationId) return;
    setRepositoryId(id); setBusy(true); setMessage(null);
    try {
      const discovery = await api.discoverGithubProjectV2(workspaceId, installationId, { repositoryId: id });
      if (discovery.connectionRequired) {
        const start = await api.startGithubProjectOAuth({ returnUrl: createGithubOnboardingReturnUrl(workspaceId, "project-oauth", installationId, id) });
        window.location.assign(start.authorizeUrl); return;
      }
      setProjects(discovery.projects); setStage("projects");
    } catch (error) { setMessage(error instanceof Error ? error.message : "ProjectV2를 조회하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function startProjectOAuth() {
    if (!workspaceId || !installationId) return;
    setBusy(true);
    try {
      const start = await api.startGithubProjectOAuth({ returnUrl: createGithubOnboardingReturnUrl(workspaceId, "project-oauth", installationId) });
      window.location.assign(start.authorizeUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : "ProjectV2 권한 동의를 시작하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function saveProjects() {
    if (!workspaceId || !installationId || !repositoryId) return;
    setBusy(true); setMessage(null);
    try { await api.replaceGithubProjectV2Selections(workspaceId, { installationId, repositoryId, projectV2Ids: projectIds }); router.replace("/home"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "ProjectV2 선택을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }

  if (!session) return <WorkspaceCenteredStatus icon={<Loader2 className="animate-spin" />} text="세션을 확인하는 중입니다." />;
  if (stage === "create") return <main className="mx-auto grid min-h-screen max-w-xl place-items-center p-6"><Card className="w-full"><CardHeader><CardTitle>workspace 만들기</CardTitle><CardDescription>workspace를 만든 뒤 GitHub 연결을 이어갑니다.</CardDescription></CardHeader><CardContent className="grid gap-4"><Input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="PILO Product Team" /><div className="flex gap-2">{ICON_OPTIONS.map((icon) => <Button key={icon} type="button" variant={workspaceIcon === icon ? "default" : "outline"} onClick={() => setWorkspaceIcon(icon)}>{icon}</Button>)}</div><Button disabled={busy || !workspaceName.trim()} onClick={() => void createAndConnect(true)}>GitHub 연결 후 계속</Button><Button disabled={busy || !workspaceName.trim()} variant="outline" onClick={() => void createAndConnect(false)}>GitHub 없이 workspace 만들기</Button>{message ? <p className="text-sm text-destructive">{message}</p> : null}</CardContent></Card></main>;
  if (stage === "installation" || stage === "syncing") return <WorkspaceCenteredStatus icon={message ? <TriangleAlert /> : <Loader2 className="animate-spin" />} text={message ?? "GitHub App 설치와 source sync를 기다리는 중입니다. 취소했다면 이 화면에서 다시 연결할 수 있습니다."} action={workspaceId ? <div className="flex gap-2"><Button onClick={() => void resumeGithub(workspaceId)}>GitHub 다시 연결</Button><Button variant="outline" onClick={() => router.replace("/home")}>나중에 연결</Button></div> : undefined} />;
  if (stage === "project-oauth") return <WorkspaceCenteredStatus icon={<PanelsTopLeft />} text="repository를 선택하기 전에 ProjectV2 권한 동의가 필요합니다." action={<div className="flex gap-2"><Button disabled={busy} onClick={() => void startProjectOAuth()}>ProjectV2 권한 동의</Button><Button variant="outline" onClick={() => router.replace("/home")}>나중에 연결</Button></div>} />;
  if (stage === "repositories") return <main className="mx-auto grid max-w-2xl gap-4 p-6"><h1 className="text-2xl font-semibold">repository 선택</h1>{repositories.length === 0 ? <p>동기화된 repository가 없습니다. source sync가 끝난 뒤 다시 시도해 주세요.</p> : repositories.map((repository) => <WorkspaceSelectionCard key={repository.id} title={repository.fullName} description={repository.archived ? "Archived" : repository.private ? "Private" : "Public"} icon={<GitBranch />} selected={repositoryId === repository.id} onClick={() => void chooseRepository(repository.id)} />)}{message ? <p className="text-sm text-destructive">{message}</p> : null}</main>;
  return <main className="mx-auto grid max-w-2xl gap-4 p-6"><h1 className="text-2xl font-semibold">ProjectV2 선택</h1>{projects.length === 0 ? <p>이 repository에서 선택할 ProjectV2가 없습니다.</p> : projects.map((project) => <WorkspaceSelectionCard key={project.id} title={project.title} description={`${project.ownerLogin} · #${project.projectNumber}`} icon={<PanelsTopLeft />} selected={projectIds.includes(project.id)} onClick={() => setProjectIds((ids) => ids.includes(project.id) ? ids.filter((id) => id !== project.id) : [...ids, project.id])} />)}<Button disabled={busy || projectIds.length === 0} onClick={() => void saveProjects()}>선택 저장 후 home으로</Button>{message ? <p className="text-sm text-destructive">{message}</p> : null}</main>;
}
