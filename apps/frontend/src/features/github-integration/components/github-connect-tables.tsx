import { ExternalLink, FolderGit2, GitPullRequest, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  GithubPullRequest,
  GithubProjectV2,
  GithubRepository,
} from "@/features/github-integration/types";
import {
  formatGithubConnectDateTime,
  formatGithubConnectNumber,
  formatGithubConnectShortDate,
} from "@/features/github-integration/utils/github-connect-format";

import {
  GithubConnectEmptyState,
  GithubConnectPanel,
  GithubConnectPill,
} from "./github-connect-primitives";

type SourceTablesProps = {
  repositories: GithubRepository[];
  repositoriesTotal: number;
  repositoryQuery: string;
  repositoryPage: number;
  hasNextRepositoryPage: boolean;
  selectedRepositoryId: string;
  selectedRepository: GithubRepository | undefined;
  pullRequests: GithubPullRequest[];
  pullRequestsTotal: number;
  isPullRequestsLoading: boolean;
  projects: GithubProjectV2[];
  projectsTotal: number;
  selectedProjectV2Id: string;
  isSavingProjectV2Selections: boolean;
  isWorkspaceOwner: boolean;
  isLoading: boolean;
  onRepositoryQueryChange: (value: string) => void;
  onRepositoryPageChange: (page: number) => void;
  onSelectRepository: (id: string) => void;
  onSelectProjectV2: (id: string) => void;
  onSaveProjectV2Selections: () => void;
};

export function GithubConnectSourceTables({
  repositories,
  repositoriesTotal,
  repositoryQuery,
  repositoryPage,
  hasNextRepositoryPage,
  selectedRepositoryId,
  selectedRepository,
  pullRequests,
  pullRequestsTotal,
  isPullRequestsLoading,
  projects,
  projectsTotal,
  selectedProjectV2Id,
  isSavingProjectV2Selections,
  isWorkspaceOwner,
  isLoading,
  onRepositoryQueryChange,
  onRepositoryPageChange,
  onSelectRepository,
  onSelectProjectV2,
  onSaveProjectV2Selections,
}: SourceTablesProps) {
  return (
    <div className="grid gap-[15px]">
      <GithubConnectPanel
        action={
          <span className="text-[13px] font-semibold text-[#687184]">
            {formatGithubConnectNumber(repositoriesTotal)} total
          </span>
        }
        collapsible
        icon={<FolderGit2 className="size-4" />}
        title="저장소"
        subtitle="GitHub 설치가 허용한 repository를 확인하고 Pull Request 조회 기준을 선택합니다."
      >
        <div className="mb-3 flex items-center gap-2 rounded-[8px] border border-[#d9dee8] bg-[#fbfcfe] px-3">
          <Search className="size-4 shrink-0 text-[#8b95a7]" />
          <Input
            className="h-10 border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0"
            onChange={(event) => onRepositoryQueryChange(event.target.value)}
            placeholder="Repository 검색"
            value={repositoryQuery}
          />
        </div>

        {isLoading ? (
          <LoadingTable rows={4} />
        ) : repositories.length === 0 && !repositoryQuery.trim() ? (
          <GithubConnectEmptyState>
            GitHub 설치가 끝나면 백엔드가 검증한 저장소 목록이 여기에
            표시됩니다.
          </GithubConnectEmptyState>
        ) : repositories.length === 0 ? (
          <GithubConnectEmptyState>
            검색 조건과 일치하는 저장소가 없습니다.
          </GithubConnectEmptyState>
        ) : (
          <div className="repo-table overflow-hidden rounded-[8px] border border-[#d9dee8]">
            <div className="repo-row header grid grid-cols-[minmax(180px,1.7fr)_90px_90px_108px_86px] gap-3 bg-[#f5f7fb] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a8497] max-[760px]:hidden">
              <span>Repository</span>
              <span>Visibility</span>
              <span>보관 상태</span>
              <span>마지막 동기화</span>
              <span>선택</span>
            </div>
            <div className="divide-y divide-[#eef1f6]">
              {repositories.map((repository) => (
                <RepositoryRow
                  isSelected={repository.id === selectedRepositoryId}
                  key={repository.id}
                  onSelect={() => onSelectRepository(repository.id)}
                  repository={repository}
                />
              ))}
            </div>
          </div>
        )}

        {repositoriesTotal > 0 ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              disabled={isLoading || repositoryPage === 1}
              onClick={() => onRepositoryPageChange(repositoryPage - 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              이전
            </Button>
            <span className="text-[12px] text-[#7a8497]">
              {repositoryPage}페이지
            </span>
            <Button
              disabled={isLoading || !hasNextRepositoryPage}
              onClick={() => onRepositoryPageChange(repositoryPage + 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              다음
            </Button>
          </div>
        ) : null}

        <p className="mt-3 text-[12px] leading-5 text-[#7a8497]">
          저장소 접근 범위는 GitHub 설치 화면에서 결정됩니다. PILO는 허용된
          저장소만 동기화합니다.
        </p>
      </GithubConnectPanel>

      <GithubConnectPanel
        collapsible
        icon={<GitPullRequest className="size-4" />}
        title="Pull Requests"
        subtitle={
          selectedRepository
            ? `${selectedRepository.fullName} · ${formatGithubConnectNumber(
                pullRequestsTotal
              )}개`
            : "저장소를 선택하면 PR 목록을 조회합니다."
        }
      >
        {!selectedRepository ? (
          <GithubConnectEmptyState>
            저장소를 선택하면 PR 및 ProjectV2 동기화 범위를 관리할 수 있습니다.
          </GithubConnectEmptyState>
        ) : isPullRequestsLoading ? (
          <LoadingStack rows={3} />
        ) : pullRequests.length === 0 ? (
          <GithubConnectEmptyState>
            선택한 저장소의 Pull Request가 없거나 아직 동기화되지 않았습니다.
          </GithubConnectEmptyState>
        ) : (
          <div className="space-y-2">
            {pullRequests.map((pullRequest) => (
              <a
                className="block rounded-[8px] border border-[#e5e9f2] bg-[#fbfcfe] p-3 transition-colors hover:border-[#c7d2fe] hover:bg-[#f5f7ff]"
                href={pullRequest.githubUrl}
                key={pullRequest.id}
                rel="noreferrer"
                target="_blank"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-[13px] font-semibold leading-5 text-[#101828]">
                    #{pullRequest.githubNumber} {pullRequest.title}
                  </p>
                  <GithubConnectPill
                    tone={pullRequest.state === "open" ? "success" : "default"}
                  >
                    {pullRequest.state}
                  </GithubConnectPill>
                </div>
                <p className="mt-2 text-[12px] text-[#7a8497]">
                  {pullRequest.headBranch ?? "-"} →{" "}
                  {pullRequest.baseBranch ?? "-"} ·{" "}
                  {pullRequest.changedFilesCount} files
                </p>
              </a>
            ))}
          </div>
        )}
      </GithubConnectPanel>

      <GithubConnectPanel
        action={
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#687184]">
              {formatGithubConnectNumber(projectsTotal)} total
            </span>
            <Button
              className="h-8 rounded-[8px] px-3"
              disabled={isLoading || isSavingProjectV2Selections || !selectedProjectV2Id || !isWorkspaceOwner}
              onClick={onSaveProjectV2Selections}
              size="sm"
              type="button"
              variant="outline"
            >
              {isSavingProjectV2Selections ? "Switching..." : "Switch Board"}
            </Button>
          </div>
        }
        collapsible
        icon={<FolderGit2 className="size-4" />}
        title="Projects v2"
        subtitle="GitHub GraphQL API를 통해 동기화된 Project v2 목록입니다."
      >
        {!selectedRepository ? (
          <GithubConnectEmptyState>
            저장소를 선택하면 PR 및 ProjectV2 동기화 범위를 관리할 수 있습니다.
          </GithubConnectEmptyState>
        ) : isLoading ? (
          <LoadingTable rows={3} />
        ) : projects.length === 0 ? (
          <GithubConnectEmptyState>
            Projects 권한이 승인되면 GitHub Projects v2 목록이 여기에
            표시됩니다.
          </GithubConnectEmptyState>
        ) : (
          <div className="project-table overflow-hidden rounded-[8px] border border-[#d9dee8]">
            <div className="project-row header grid grid-cols-[minmax(180px,1.7fr)_120px_112px_100px] gap-3 bg-[#f5f7fb] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a8497] max-[760px]:hidden">
              <span>Project</span>
              <span>Owner</span>
              <span>Updated</span>
              <span>상태</span>
            </div>
            <div className="divide-y divide-[#eef1f6]">
              {projects.map((project) => (
                <ProjectRow
                  isSelected={project.id === selectedProjectV2Id}
                  key={project.id}
                  onSelect={() => onSelectProjectV2(project.id)}
                  project={project}
                />
              ))}
            </div>
          </div>
        )}

        <p className="mt-3 text-[12px] leading-5 text-[#7a8497]">
          Project v2 데이터는 GitHub GraphQL API를 사용하며, 설치 권한에
          Projects 접근 권한이 포함되어야 합니다.
        </p>
      </GithubConnectPanel>
    </div>
  );
}

function RepositoryRow({
  repository,
  isSelected,
  onSelect,
}: {
  repository: GithubRepository;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`repo-row grid grid-cols-[minmax(180px,1.7fr)_90px_90px_108px_86px] items-center gap-3 px-3 py-3 text-[13px] max-[760px]:grid-cols-1 max-[760px]:gap-2 ${
        isSelected ? "bg-[#f5f7ff]" : "bg-white"
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-semibold text-[#101828]">
            {repository.fullName}
          </p>
          <a
            aria-label={`${repository.fullName} GitHub에서 열기`}
            className="shrink-0 text-[#7a8497] hover:text-[#3157d5]"
            href={repository.htmlUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <p className="mt-1 text-[12px] text-[#7a8497]">
          default: {repository.defaultBranch ?? "-"} · pushed{" "}
          {formatGithubConnectShortDate(repository.pushedAt)}
        </p>
      </div>
      <span className="text-[#4d586b]">
        {repository.private ? "Private" : "Public"}
      </span>
      <span className="text-[#4d586b]">
        {repository.archived ? "Archived" : "Active"}
      </span>
      <span className="text-[#4d586b]">
        {formatGithubConnectDateTime(repository.lastSyncedAt)}
      </span>
      <Button
        className="h-8 rounded-[8px] px-3"
        onClick={onSelect}
        size="sm"
        type="button"
        variant={isSelected ? "default" : "outline"}
      >
        {isSelected ? "선택됨" : "선택"}
      </Button>
    </div>
  );
}

function ProjectRow({
  project,
  isSelected,
  onSelect,
}: {
  project: GithubProjectV2;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`project-row grid grid-cols-[minmax(180px,1.7fr)_120px_112px_100px] items-center gap-3 px-3 py-3 text-[13px] max-[760px]:grid-cols-1 max-[760px]:gap-2 ${
        isSelected ? "bg-[#f5f7ff]" : "bg-white"
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-semibold text-[#101828]">
            {project.title}
          </p>
          <a
            aria-label={`${project.title} GitHub에서 열기`}
            className="shrink-0 text-[#7a8497] hover:text-[#3157d5]"
            href={project.url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <p className="mt-1 line-clamp-1 text-[12px] text-[#7a8497]">
          #{project.projectNumber} · {project.shortDescription ?? "설명 없음"}
        </p>
      </div>
      <span className="text-[#4d586b]">{project.ownerLogin}</span>
      <span className="text-[#4d586b]">
        {formatGithubConnectShortDate(project.lastSyncedAt)}
      </span>
      <div className="flex items-center gap-2">
        <GithubConnectPill tone={project.closed ? "danger" : "success"}>
          {project.closed ? "Closed" : "Open"}
        </GithubConnectPill>
        <Button
          className="h-8 rounded-[8px] px-3"
          onClick={onSelect}
          size="sm"
          type="button"
          variant={isSelected ? "default" : "outline"}
        >
          {isSelected ? "선택됨" : "선택"}
        </Button>
      </div>
    </div>
  );
}

function LoadingTable({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton className="h-14 rounded-[8px]" key={index} />
      ))}
    </div>
  );
}

function LoadingStack({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton className="h-16 rounded-[8px]" key={index} />
      ))}
    </div>
  );
}
