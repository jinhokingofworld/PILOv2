import {
  AlertCircle,
  ArrowLeft,
  GitBranch,
  GitPullRequest,
  Loader2,
  RefreshCcw
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { getPrReviewAnalysisRetryLabel } from "@/features/pr-review/analysis-status";
import type {
  PrReviewPullRequest,
  PrReviewPullRequestDetail,
  PrReviewSession
} from "@/features/pr-review/types";

type PrReviewAnalysisStatusProps = {
  backLabel: string;
  isDelayed: boolean;
  isRetrying: boolean;
  onBackToSelection: () => void;
  onRetry: () => void;
  pollingError: string | null;
  pullRequest: PrReviewPullRequest | PrReviewPullRequestDetail | null;
  retryError: string | null;
  session: PrReviewSession;
};

export function PrReviewAnalysisStatus({
  backLabel,
  isDelayed,
  isRetrying,
  onBackToSelection,
  onRetry,
  pollingError,
  pullRequest,
  retryError,
  session
}: PrReviewAnalysisStatusProps) {
  const isAnalyzing = session.status === "analyzing";
  const analysisError = session.analysisError;

  return (
    <main
      className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center px-4 py-10"
      style={{
        fontFamily:
          'Pretendard, "Noto Sans KR", "Malgun Gothic", Inter, sans-serif'
      }}
    >
      <Card className="w-full rounded-lg">
        <CardHeader className="items-center text-center">
          <span
            className={
              isAnalyzing
                ? "inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
                : "inline-flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            }
          >
            {isAnalyzing ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <AlertCircle className="size-6" />
            )}
          </span>
          <CardTitle className="mt-3 break-keep text-balance text-xl">
            {isAnalyzing ? "PR 분석 중" : "PR 분석을 완료하지 못했습니다"}
          </CardTitle>
          <CardDescription className="max-w-lg break-keep text-balance leading-6">
            {isAnalyzing
              ? "변경 파일과 PR 정보를 분석하고 있습니다. 분석이 끝나면 자동으로 리뷰 공간을 엽니다."
              : (analysisError?.message ??
                "분석을 완료하지 못했습니다. 새 분석을 시작해주세요.")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <GitPullRequest className="size-4 text-primary" />
              <span>
                {pullRequest
                  ? `#${pullRequest.githubNumber} ${pullRequest.title}`
                  : "선택한 Pull Request"}
              </span>
            </div>
            {pullRequest ? (
              <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
                <GitBranch className="size-3.5" />
                {pullRequest.headBranch ?? "-"} → {pullRequest.baseBranch ?? "-"}
              </p>
            ) : null}
          </div>

          {isAnalyzing && isDelayed ? (
            <div
              aria-live="polite"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950"
            >
              분석 시간이 예상보다 길어지고 있습니다. 실패로 처리하지 않고 계속 상태를 확인합니다.
            </div>
          ) : null}

          {isAnalyzing && pollingError ? (
            <div
              aria-live="polite"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950"
            >
              {pollingError}
            </div>
          ) : null}

          {retryError ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {retryError}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button
              disabled={isRetrying}
              onClick={onBackToSelection}
              type="button"
              variant="secondary"
            >
              <ArrowLeft className="size-4" />
              {backLabel}
            </Button>
            {!isAnalyzing ? (
              <Button disabled={isRetrying} onClick={onRetry} type="button">
                {isRetrying ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCcw className="size-4" />
                )}
                {getPrReviewAnalysisRetryLabel(analysisError?.code)}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
