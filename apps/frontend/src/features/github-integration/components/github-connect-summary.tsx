import { CheckCircle2, Cloud, FolderGit2 } from "lucide-react";

import {
  formatGithubConnectDateTime,
  formatGithubConnectNumber
} from "@/features/github-integration/utils/github-connect-format";

type SummaryProps = {
  connected: boolean;
  githubLogin: string | null | undefined;
  connectedAt: string | null | undefined;
  repositoriesTotal: number;
  projectsTotal: number;
  installationsTotal: number;
};

export function GithubConnectSummary({
  connected,
  githubLogin,
  connectedAt,
  repositoriesTotal,
  projectsTotal,
  installationsTotal
}: SummaryProps) {
  return (
    <div className="summary-strip grid gap-3 md:grid-cols-3">
      <article className="js-metric-install rounded-[8px] border border-[#d9dee8] bg-white p-4 shadow-[0_10px_28px_rgba(15,20,34,0.06)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7a8497]">
              설치 상태
            </p>
            <p className="mt-2 text-[22px] font-semibold leading-none text-[#101828]">
              {connected ? "연결됨" : "대기"}
            </p>
          </div>
          <span className="inline-flex size-9 items-center justify-center rounded-[8px] bg-[#effbf3] text-[#159947]">
            <CheckCircle2 className="size-5" />
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-5 text-[#687184]">
          {connected
            ? `@${githubLogin ?? "unknown"} · ${formatGithubConnectDateTime(
                connectedAt ?? null
              )}`
            : "OAuth 연결과 GitHub App 설치가 필요합니다."}
        </p>
      </article>

      <article className="rounded-[8px] border border-[#d9dee8] bg-white p-4 shadow-[0_10px_28px_rgba(15,20,34,0.06)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7a8497]">
              허용 저장소
            </p>
            <p className="mt-2 text-[22px] font-semibold leading-none text-[#101828]">
              {formatGithubConnectNumber(repositoriesTotal)}
            </p>
          </div>
          <span className="inline-flex size-9 items-center justify-center rounded-[8px] bg-[#eff6ff] text-[#2f6bff]">
            <FolderGit2 className="size-5" />
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-5 text-[#687184]">
          GitHub 설치 화면에서 허용한 저장소만 표시됩니다.
        </p>
      </article>

      <article className="rounded-[8px] border border-[#d9dee8] bg-white p-4 shadow-[0_10px_28px_rgba(15,20,34,0.06)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7a8497]">
              연결 Projects
            </p>
            <p className="mt-2 text-[22px] font-semibold leading-none text-[#101828]">
              {formatGithubConnectNumber(projectsTotal)}
            </p>
          </div>
          <span className="inline-flex size-9 items-center justify-center rounded-[8px] bg-[#fff8e8] text-[#b87900]">
            <Cloud className="size-5" />
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-5 text-[#687184]">
          {installationsTotal > 0
            ? `${formatGithubConnectNumber(installationsTotal)}개 installation 기준`
            : "Projects 권한 승인 후 목록이 채워집니다."}
        </p>
      </article>
    </div>
  );
}
