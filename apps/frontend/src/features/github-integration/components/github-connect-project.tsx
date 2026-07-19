"use client";

import { useState } from "react";
import { PanelsTopLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import type {
  GithubProjectV2,
  GithubRepository
} from "@/features/github-integration/types";

import {
  GithubConnectEmptyState,
  GithubConnectPanel,
  GithubConnectPill
} from "./github-connect-primitives";

type GithubConnectProjectProps = {
  projects: GithubProjectV2[];
  activeProjectV2Id: string;
  selectedRepository: GithubRepository | undefined;
  projectOAuthConnected: boolean;
  isWorkspaceOwner: boolean;
  isActivating: boolean;
  onActivateProjectV2: (projectV2Id: string) => Promise<void>;
};

export function GithubConnectProject({
  projects,
  activeProjectV2Id,
  selectedRepository,
  projectOAuthConnected,
  isWorkspaceOwner,
  isActivating,
  onActivateProjectV2
}: GithubConnectProjectProps) {
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const activeProject = projects.find((project) => project.id === activeProjectV2Id);

  async function handleProjectChoice(projectV2Id: string) {
    setDialogError(null);
    try {
      const project = projects.find((candidate) => candidate.id === projectV2Id);
      if (!project) return;
      await onActivateProjectV2(project.id);
      setOpen(false);
    } catch (error) {
      setDialogError(
        error instanceof Error
          ? error.message
          : "활성 Board를 변경하지 못했습니다."
      );
    }
  }

  const needsProjectOAuth = (project: GithubProjectV2) =>
    project.ownerType === "User" && !projectOAuthConnected;

  return (
    <GithubConnectPanel
      action={
        <Dialog
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setDialogError(null);
          }}
          open={open}
        >
          <DialogTrigger
            render={
              <Button
                className="h-8 rounded-[8px] px-3"
                disabled={!selectedRepository || !isWorkspaceOwner || isActivating}
                size="sm"
                type="button"
                variant="outline"
              />
            }
          >
            활성 Board 변경
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>활성 Board 변경</DialogTitle>
              <DialogDescription>
                {selectedRepository
                  ? `${selectedRepository.fullName}에 연결된 Project v2를 선택하세요.`
                  : "먼저 repository를 선택하세요."}
              </DialogDescription>
            </DialogHeader>

            {dialogError ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {dialogError}
              </p>
            ) : null}

            <div className="max-h-72 space-y-2 overflow-y-auto">
              {projects.length === 0 ? (
                <GithubConnectEmptyState>
                  선택한 repository에 연결된 Project v2가 없습니다.
                </GithubConnectEmptyState>
              ) : projects.map((project) => {
                const isActive = project.id === activeProjectV2Id;
                const projectOAuthRequired = needsProjectOAuth(project);
                return (
                  <div
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    key={project.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{project.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {project.ownerLogin} · #{project.projectNumber}
                      </p>
                    </div>
                    {isActive ? (
                      <GithubConnectPill tone="success">현재 Board</GithubConnectPill>
                    ) : projectOAuthRequired ? (
                      <GithubConnectPill tone="warning">작업 권한 필요</GithubConnectPill>
                    ) : (
                      <Button
                        disabled={!isWorkspaceOwner || isActivating}
                        onClick={() => void handleProjectChoice(project.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {isActivating ? "변경 중..." : "선택"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      }
      collapsible
      icon={<PanelsTopLeft className="size-4" />}
      subtitle="선택한 Project v2가 Workspace의 활성 Board가 됩니다."
      title="Projects v2"
      tone="project"
    >
      {!selectedRepository ? (
        <GithubConnectEmptyState>
          repository를 선택하면 연결된 Project v2를 확인할 수 있습니다.
        </GithubConnectEmptyState>
      ) : activeProject ? (
        <div className="rounded-[8px] border border-[#d9dee8] bg-[#fbfcfe] p-3">
          <p className="text-[12px] text-[#7a8497]">현재 활성 Board</p>
          <p className="mt-1 text-sm font-semibold text-[#101828]">
            {activeProject.title}
          </p>
          <p className="mt-1 text-[12px] text-[#7a8497]">
            {activeProject.ownerLogin} · #{activeProject.projectNumber}
          </p>
          <GithubConnectPill className="mt-2" tone="info">
            {activeProject.ownerType === "Organization" ? "Organization" : "Personal"}
          </GithubConnectPill>
        </div>
      ) : projects.length === 0 ? (
        <GithubConnectEmptyState>
          선택한 repository에 연결된 Project v2가 없습니다.
        </GithubConnectEmptyState>
      ) : (
        <GithubConnectEmptyState>
          활성 Board를 선택해주세요.
        </GithubConnectEmptyState>
      )}
    </GithubConnectPanel>
  );
}
