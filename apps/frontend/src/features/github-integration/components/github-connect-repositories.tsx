import { ExternalLink, FolderGit2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { GithubRepository } from "@/features/github-integration/types";
import {
  formatGithubConnectDateTime,
  formatGithubConnectNumber,
  formatGithubConnectShortDate
} from "@/features/github-integration/utils/github-connect-format";

import {
  GithubConnectEmptyState,
  GithubConnectPanel
} from "./github-connect-primitives";

type GithubConnectRepositoriesProps = {
  repositories: GithubRepository[];
  repositoriesTotal: number;
  repositoryQuery: string;
  repositoryPage: number;
  hasNextRepositoryPage: boolean;
  selectedRepositoryId: string;
  restoredRepository: GithubRepository | null;
  isLoading: boolean;
  enabled: boolean;
  onRepositoryQueryChange: (value: string) => void;
  onRepositoryPageChange: (page: number) => void;
  onSelectRepository: (id: string) => void;
};

export function GithubConnectRepositories({
  repositories,
  repositoriesTotal,
  repositoryQuery,
  repositoryPage,
  hasNextRepositoryPage,
  selectedRepositoryId,
  restoredRepository,
  isLoading,
  enabled,
  onRepositoryQueryChange,
  onRepositoryPageChange,
  onSelectRepository
}: GithubConnectRepositoriesProps) {
  return (
    <GithubConnectPanel
      action={
        <span className="text-[13px] font-semibold text-[#687184]">
          {formatGithubConnectNumber(repositoriesTotal)} total
        </span>
      }
      collapsible
      icon={<FolderGit2 className="size-4" />}
      subtitle="Project를 조회하고 동기화할 repository를 선택합니다."
      title="저장소"
      tone="repository"
    >
      {!enabled ? (
        <GithubConnectEmptyState>
          GitHub App 설치 후 저장소를 선택할 수 있습니다.
        </GithubConnectEmptyState>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-[8px] border border-[#d9dee8] bg-[#fbfcfe] px-3">
            <Search className="size-4 shrink-0 text-[#8b95a7]" />
            <Input
              className="h-10 border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0"
              onChange={(event) => onRepositoryQueryChange(event.target.value)}
              placeholder="Repository 검색"
              value={repositoryQuery}
            />
          </div>

          {restoredRepository ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-[8px] border border-[#dbe3ff] bg-[#f7f9ff] px-3 py-2 text-[13px]">
              <span className="shrink-0 font-semibold text-[#3157d5]">현재 선택</span>
              <span className="min-w-0 truncate font-medium text-[#344054]">
                {restoredRepository.fullName}
              </span>
            </div>
          ) : null}

          {isLoading ? (
            <LoadingTable rows={4} />
          ) : repositories.length === 0 && !repositoryQuery.trim() ? (
            <GithubConnectEmptyState>
              GitHub App 설치가 끝나면 권한이 확인된 저장소 목록이 여기에 표시됩니다.
            </GithubConnectEmptyState>
          ) : repositories.length === 0 ? (
            <GithubConnectEmptyState>
              검색 조건과 일치하는 저장소가 없습니다.
            </GithubConnectEmptyState>
          ) : (
            <div className="repo-table overflow-hidden rounded-[8px] border border-[#d9dee8]">
              <div className="repo-row header hidden gap-3 bg-[#f5f7fb] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a8497] @[48rem]:grid @[48rem]:grid-cols-[minmax(180px,1.7fr)_90px_90px_108px_86px]">
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
        </>
      )}
    </GithubConnectPanel>
  );
}

function RepositoryRow({
  repository,
  isSelected,
  onSelect
}: {
  repository: GithubRepository;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`repo-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 text-[13px] @[48rem]:grid-cols-[minmax(180px,1.7fr)_90px_90px_108px_86px] @[48rem]:gap-3 ${
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
      <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#4d586b] @[48rem]:row-start-auto @[48rem]:contents">
        <span>{repository.private ? "Private" : "Public"}</span>
        <span>{repository.archived ? "Archived" : "Active"}</span>
        <span>{formatGithubConnectDateTime(repository.lastSyncedAt)}</span>
      </div>
      <Button
        className="col-start-2 row-start-1 h-8 rounded-[8px] px-3 @[48rem]:col-start-auto @[48rem]:row-start-auto"
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

function LoadingTable({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton className="h-14 rounded-[8px]" key={index} />
      ))}
    </div>
  );
}
