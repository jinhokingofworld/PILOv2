"use client";

import { GitBranch, Link2, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GitHubSettingsPlaceholderProps = {
  canManageWorkspace: boolean;
};

export function GitHubSettingsPlaceholder({
  canManageWorkspace
}: GitHubSettingsPlaceholderProps) {
  return (
    <div className="grid gap-10">
      <section aria-labelledby="personal-github-heading">
        <div>
          <h3 className="font-medium" id="personal-github-heading">
            개인 GitHub 연결
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            로그인한 사용자의 GitHub OAuth 및 ProjectV2 연결 상태를 표시할 영역입니다.
          </p>
        </div>
        <Card className="mt-5 rounded-none border-y bg-transparent py-0 ring-0">
          <CardContent className="flex items-center justify-between gap-5 px-0 py-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <GitBranch className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-medium">GitHub 계정</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  `/me/github`과 `/me/github/project-oauth` 계약을 재사용합니다.
                </p>
              </div>
            </div>
            <Badge className="shrink-0" variant="outline">
              연동 예정
            </Badge>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="workspace-github-heading">
        <div>
          <h3 className="font-medium" id="workspace-github-heading">
            Workspace GitHub App
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Workspace installation과 repository 연결 상태를 표시할 영역입니다.
          </p>
        </div>
        <Card className="mt-5 ring-0">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Link2 className="size-5" />
              </span>
              <div>
                <CardTitle>GitHub App installation</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  기존 Workspace GitHub Integration API를 연결합니다.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex items-start gap-3 border-t text-sm text-muted-foreground">
            <Settings2 className="mt-0.5 size-4 shrink-0" />
            <p className="leading-6">
              {canManageWorkspace
                ? "Owner는 installation 조회·시작과 기존 연결 해제를 사용할 수 있습니다."
                : "Member는 installation 조회·시작을 사용할 수 있고, 기존 연결 해제는 Owner만 가능합니다."}
            </p>
          </CardContent>
        </Card>
      </section>

      <p className="text-xs leading-5 text-muted-foreground">
        이 화면은 후속 GitHub Integration 작업을 위한 UI 진입점입니다. 현재는 연결
        상태를 조회하거나 변경하지 않습니다.
      </p>
    </div>
  );
}
