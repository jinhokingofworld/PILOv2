"use client";

import { GitBranchPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  GithubProjectV2,
  GithubRepository
} from "@/features/github-integration/types";

type BoardHydrationFormProps = {
  error?: string | null;
  isHydrating: boolean;
  onHydrate: () => void;
  onSelectProjectV2: (projectV2Id: string) => void;
  onSelectRepository: (repositoryId: string) => void;
  projects: GithubProjectV2[];
  repositories: GithubRepository[];
  selectedProjectV2Id: string;
  selectedRepositoryId: string;
};

const selectClassName =
  "h-9 w-full rounded-[11px] border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm outline-none transition focus-visible:border-violet-300 focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-50";

export function BoardHydrationForm({
  error,
  isHydrating,
  onHydrate,
  onSelectProjectV2,
  onSelectRepository,
  projects,
  repositories,
  selectedProjectV2Id,
  selectedRepositoryId
}: BoardHydrationFormProps) {
  const hasSelectedProjectV2 = projects.some(
    (project) => project.id === selectedProjectV2Id
  );
  const canHydrate = Boolean(
    selectedRepositoryId && selectedProjectV2Id && hasSelectedProjectV2 && !isHydrating
  );

  return (
    <div className="board-hydrate-form grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-500">Board hydrate</p>
        <p className="mt-1 text-[12.5px] font-medium text-slate-400">
          GitHub 저장소와 ProjectV2 조합으로 읽기 전용 Board cache를 구성합니다.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-bold text-slate-500">
          저장소
          <select
            className={selectClassName}
            disabled={repositories.length === 0 || isHydrating}
            value={selectedRepositoryId}
            onChange={(event) => onSelectRepository(event.currentTarget.value)}
          >
            <option value="">저장소 선택</option>
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.fullName}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-bold text-slate-500">
          ProjectV2
          <select
            className={selectClassName}
            disabled={projects.length === 0 || isHydrating}
            value={selectedProjectV2Id}
            onChange={(event) => onSelectProjectV2(event.currentTarget.value)}
          >
            <option value="">
              {projects.length === 0 ? "연결된 ProjectV2 없음" : "ProjectV2 선택"}
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                #{project.projectNumber} {project.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Button type="button" disabled={!canHydrate} onClick={onHydrate}>
        {isHydrating ? <Loader2 className="animate-spin" /> : <GitBranchPlus />}
        보드 구성
      </Button>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 lg:col-span-3">
          {error}
        </p>
      ) : null}
    </div>
  );
}
