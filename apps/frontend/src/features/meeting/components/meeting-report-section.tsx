"use client";

import {
  AlertCircle,
  ArrowDownWideNarrow,
  CheckCircle2,
  Clock3,
  FileText,
  ListChecks,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { MeetingWorkspaceData } from "@/features/meeting/hooks/use-meeting-workspace-data";
import type {
  MeetingReportDetail,
  MeetingReportStatus,
  MeetingReportSummary
} from "@/features/meeting/types";
import { cn } from "@/lib/utils";

export type MeetingReportStatusFilter = "ALL" | MeetingReportStatus;

type MeetingReportSectionProps = {
  meetingData: MeetingWorkspaceData;
  onStatusFilterChange: (status: MeetingReportStatusFilter) => void;
  onToastMessage: (message: string) => void;
  statusFilter: MeetingReportStatusFilter;
};

type ReportDetailStatus = "idle" | "loading" | "success" | "error";

type ParsedActionItemCandidate = {
  assigneeUserId: string | null;
  description: string | null;
  priority: string | null;
  title: string;
};

const REPORT_POLL_INTERVAL_MS = 10000;
const REPORT_STATUS_FILTERS: Array<{
  label: string;
  value: MeetingReportStatusFilter;
}> = [
  { label: "전체", value: "ALL" },
  { label: "생성 중", value: "PROCESSING" },
  { label: "완료", value: "COMPLETED" },
  { label: "실패", value: "FAILED" }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getReportRequestErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "회의록 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function formatReportDateTime(value: string | null | undefined) {
  if (!value) {
    return "날짜 미정";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "numeric",
    year: "numeric"
  }).format(date);
}

function formatReportTitle(report: Pick<MeetingReportSummary, "createdAt">) {
  return `${formatReportDateTime(report.createdAt)} 회의록`;
}

function getReportStatusLabel(status: MeetingReportStatus) {
  switch (status) {
    case "PROCESSING":
      return "생성 중";
    case "COMPLETED":
      return "완료";
    case "FAILED":
      return "실패";
  }
}

function getReportFailedStepLabel(
  failedStep: MeetingReportSummary["failedStep"]
) {
  switch (failedStep) {
    case "RECORDING":
      return "녹음 단계";
    case "STT":
      return "음성 변환";
    case "LLM":
      return "회의록 생성";
    default:
      return "없음";
  }
}

function getReportStatusTone(status: MeetingReportStatus) {
  switch (status) {
    case "PROCESSING":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "COMPLETED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "FAILED":
      return "border-destructive/30 bg-destructive/10 text-destructive";
  }
}

function getReportStatusIcon(status: MeetingReportStatus) {
  switch (status) {
    case "PROCESSING":
      return Clock3;
    case "COMPLETED":
      return CheckCircle2;
    case "FAILED":
      return XCircle;
  }
}

function getActionPriorityLabel(priority: string | null) {
  switch (priority) {
    case "HIGH":
      return "높음";
    case "MEDIUM":
      return "보통";
    case "LOW":
      return "낮음";
    default:
      return priority;
  }
}

function parseActionItemCandidates(
  candidates: unknown[]
): ParsedActionItemCandidate[] {
  return candidates
    .map((candidate, index) => {
      if (typeof candidate === "string" && candidate.trim()) {
        return {
          assigneeUserId: null,
          description: null,
          priority: null,
          title: candidate.trim()
        };
      }

      if (!isRecord(candidate)) {
        return null;
      }

      const title = readString(candidate.title);

      if (!title) {
        return null;
      }

      return {
        assigneeUserId: readString(candidate.assigneeUserId),
        description: readString(candidate.description),
        priority: readString(candidate.priority),
        title: title || `후속 작업 ${index + 1}`
      };
    })
    .filter((candidate): candidate is ParsedActionItemCandidate =>
      Boolean(candidate)
    );
}

function buildReportSearchText(report: MeetingReportSummary) {
  return [
    formatReportTitle(report),
    getReportStatusLabel(report.status),
    getReportFailedStepLabel(report.failedStep),
    report.summary,
    report.discussionPoints,
    report.decisions,
    report.errorMessage
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function ReportStatusPill({ status }: { status: MeetingReportStatus }) {
  const StatusIcon = getReportStatusIcon(status);

  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold",
        getReportStatusTone(status)
      )}
    >
      <StatusIcon className="size-3.5" />
      {getReportStatusLabel(status)}
    </span>
  );
}

function ReportListSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="rounded-lg border bg-background p-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-3 h-4 w-72 max-w-full" />
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportTextBlock({
  emptyLabel,
  title,
  value
}: {
  emptyLabel: string;
  title: string;
  value: string | null;
}) {
  return (
    <section className="grid gap-2">
      <h3 className="font-heading text-base font-semibold">{title}</h3>
      <div className="min-h-24 whitespace-pre-wrap break-words rounded-lg border bg-background p-3 text-sm leading-6">
        {value?.trim() || (
          <span className="text-muted-foreground">{emptyLabel}</span>
        )}
      </div>
    </section>
  );
}

function MeetingReportDetailSheet({
  detailError,
  detailStatus,
  onClose,
  onRegenerate,
  open,
  regenerating,
  report
}: {
  detailError: string | null;
  detailStatus: ReportDetailStatus;
  onClose: () => void;
  onRegenerate: (report: MeetingReportSummary) => void;
  open: boolean;
  regenerating: boolean;
  report: MeetingReportDetail | null;
}) {
  const actionItems = parseActionItemCandidates(
    report?.actionItemCandidates ?? []
  );

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>회의록 상세</SheetTitle>
          <SheetDescription>
            {report ? formatReportDateTime(report.createdAt) : "불러오는 중"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {detailStatus === "loading" && !report ? (
            <div className="grid gap-4">
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-40 rounded-lg" />
            </div>
          ) : detailStatus === "error" ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {detailError ?? "회의록 상세를 불러오지 못했습니다."}
            </div>
          ) : report ? (
            <div className="grid gap-5">
              <section className="grid gap-4 rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground">
                      회의 날짜
                    </p>
                    <h2 className="mt-1 break-words font-heading text-xl font-semibold">
                      {formatReportTitle(report)}
                    </h2>
                  </div>
                  <ReportStatusPill status={report.status} />
                </div>

                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-muted-foreground">
                      실패 단계
                    </dt>
                    <dd className="mt-1">
                      {getReportFailedStepLabel(report.failedStep)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">
                      재생성 횟수
                    </dt>
                    <dd className="mt-1">{report.retryCount}회</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">
                      생성일
                    </dt>
                    <dd className="mt-1">
                      {formatReportDateTime(report.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">
                      수정일
                    </dt>
                    <dd className="mt-1">
                      {formatReportDateTime(report.updatedAt)}
                    </dd>
                  </div>
                </dl>

                {report.errorMessage ? (
                  <div className="rounded-lg border border-destructive/30 bg-background p-3 text-sm text-destructive">
                    {report.errorMessage}
                  </div>
                ) : null}
              </section>

              <ReportTextBlock
                emptyLabel={
                  report.status === "PROCESSING"
                    ? "회의록을 생성하는 중입니다."
                    : "등록된 요약이 없습니다."
                }
                title="요약"
                value={report.summary}
              />

              <ReportTextBlock
                emptyLabel={
                  report.status === "PROCESSING"
                    ? "논의사항을 정리하는 중입니다."
                    : "등록된 논의사항이 없습니다."
                }
                title="논의사항"
                value={report.discussionPoints}
              />

              <ReportTextBlock
                emptyLabel={
                  report.status === "PROCESSING"
                    ? "결정사항을 정리하는 중입니다."
                    : "등록된 결정사항이 없습니다."
                }
                title="결정사항"
                value={report.decisions}
              />

              <section className="grid gap-2">
                <h3 className="font-heading text-base font-semibold">
                  후속 작업 후보
                </h3>
                {actionItems.length ? (
                  <ul className="grid gap-2">
                    {actionItems.map((item, index) => (
                      <li
                        key={`${item.title}-${index}`}
                        className="rounded-lg border bg-background p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 font-medium">
                            {item.title}
                          </p>
                          {item.priority ? (
                            <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {getActionPriorityLabel(item.priority)}
                            </span>
                          ) : null}
                        </div>
                        {item.description ? (
                          <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                            {item.description}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    등록된 후속 작업 후보가 없습니다.
                  </p>
                )}
              </section>

              <ReportTextBlock
                emptyLabel={
                  report.status === "PROCESSING"
                    ? "음성 텍스트를 정리하는 중입니다."
                    : "등록된 transcript가 없습니다."
                }
                title="Transcript"
                value={report.transcriptText}
              />
            </div>
          ) : null}
        </div>

        {report?.status === "FAILED" ? (
          <SheetFooter className="border-t">
            <Button
              type="button"
              variant="outline"
              disabled={regenerating}
              onClick={() => onRegenerate(report)}
            >
              {regenerating ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
              재생성 요청
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function MeetingReportSection({
  meetingData,
  onStatusFilterChange,
  onToastMessage,
  statusFilter
}: MeetingReportSectionProps) {
  const {
    canLoad,
    getMeetingReport,
    regenerateMeetingReport,
    reloadReports,
    reports,
    reportsError,
    reportsStatus
  } = meetingData;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReport, setSelectedReport] =
    useState<MeetingReportDetail | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] =
    useState<ReportDetailStatus>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [regeneratingReportId, setRegeneratingReportId] =
    useState<string | null>(null);

  const filteredReports = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return reports;
    }

    return reports.filter((report) =>
      buildReportSearchText(report).includes(query)
    );
  }, [reports, searchQuery]);

  const hasProcessingReport = reports.some(
    (report) => report.status === "PROCESSING"
  );
  const isInitialLoading = reportsStatus === "loading" && reports.length === 0;
  const showError = reportsStatus === "error" && reports.length === 0;

  const loadReportDetail = useCallback(
    async (
      reportId: string,
      options: {
        silent?: boolean;
      } = {}
    ) => {
      if (!options.silent) {
        setDetailStatus("loading");
      }
      setDetailError(null);

      try {
        const result = await getMeetingReport(reportId);
        setSelectedReport(result.report);
        setDetailStatus("success");
        return result.report;
      } catch (error) {
        const message = getReportRequestErrorMessage(error);
        setDetailError(message);
        setDetailStatus("error");
        return null;
      }
    },
    [getMeetingReport]
  );

  const handleOpenReport = useCallback(
    (report: MeetingReportSummary) => {
      setSelectedReportId(report.id);
      setSelectedReport({
        ...report,
        transcriptText: null
      });
      void loadReportDetail(report.id);
    },
    [loadReportDetail]
  );

  const handleCloseReport = useCallback(() => {
    setSelectedReportId(null);
    setSelectedReport(null);
    setDetailStatus("idle");
    setDetailError(null);
  }, []);

  const handleRegenerateReport = useCallback(
    async (report: MeetingReportSummary) => {
      if (!window.confirm("실패한 회의록을 다시 생성할까요?")) {
        return;
      }

      setRegeneratingReportId(report.id);

      try {
        const result = await regenerateMeetingReport(report.id);
        onToastMessage("회의록 재생성을 요청했습니다.");

        if (statusFilter === "FAILED") {
          onStatusFilterChange("ALL");
        }

        setSelectedReport({
          ...result.report,
          transcriptText: null
        });

        if (selectedReportId === report.id) {
          await loadReportDetail(report.id, { silent: true });
        }
      } catch (error) {
        onToastMessage(getReportRequestErrorMessage(error));
      } finally {
        setRegeneratingReportId(null);
      }
    },
    [
      loadReportDetail,
      onStatusFilterChange,
      onToastMessage,
      regenerateMeetingReport,
      selectedReportId,
      statusFilter
    ]
  );

  useEffect(() => {
    if (
      !canLoad ||
      (!hasProcessingReport && selectedReport?.status !== "PROCESSING")
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void reloadReports();

      if (selectedReportId && selectedReport?.status === "PROCESSING") {
        void loadReportDetail(selectedReportId, { silent: true });
      }
    }, REPORT_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [
    canLoad,
    hasProcessingReport,
    loadReportDetail,
    reloadReports,
    selectedReport?.status,
    selectedReportId
  ]);

  return (
    <section
      id="report"
      className="grid min-h-[calc(100vh-8rem)] gap-5 rounded-xl border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-semibold">회의록</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            60초 이하 녹음은 회의록이 생성되지 않습니다.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={reportsStatus === "loading"}
          onClick={() => void reloadReports()}
        >
          {reportsStatus === "loading" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          새로고침
        </Button>
      </div>

      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="회의록 검색"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {REPORT_STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={statusFilter === filter.value ? "default" : "outline"}
              onClick={() => onStatusFilterChange(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium text-muted-foreground">
            <ArrowDownWideNarrow className="size-3.5" />
            최신순
          </span>
        </div>
      </div>

      {hasProcessingReport ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <Loader2 className="size-4 animate-spin" />
          생성 중인 회의록을 확인하고 있습니다.
        </div>
      ) : null}

      {reportsStatus === "error" && reports.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{reportsError?.message ?? "회의록 목록을 갱신하지 못했습니다."}</p>
        </div>
      ) : null}

      <div className="min-h-96 rounded-lg border bg-muted/20 p-3 sm:p-5">
        {isInitialLoading ? (
          <ReportListSkeleton />
        ) : showError ? (
          <div className="grid min-h-80 place-items-center text-center">
            <div className="max-w-sm">
              <AlertCircle className="mx-auto size-8 text-destructive" />
              <p className="mt-3 text-sm font-medium">
                회의록 목록을 불러오지 못했습니다.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {reportsError?.message ?? "잠시 후 다시 시도해주세요."}
              </p>
              <Button
                className="mt-4"
                type="button"
                variant="outline"
                onClick={() => void reloadReports()}
              >
                <RefreshCw />
                다시 불러오기
              </Button>
            </div>
          </div>
        ) : filteredReports.length ? (
          <ul className="mx-auto grid w-full max-w-4xl gap-3">
            {filteredReports.map((report) => (
              <li
                key={report.id}
                className="grid gap-3 rounded-lg border bg-background p-4 transition hover:border-primary/30 hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <button
                  type="button"
                  className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => handleOpenReport(report)}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <h3 className="truncate font-heading text-base font-semibold">
                      {formatReportTitle(report)}
                    </h3>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                    {report.summary?.trim() ||
                      report.errorMessage?.trim() ||
                      (report.status === "PROCESSING"
                        ? "회의록을 생성하는 중입니다."
                        : "등록된 요약이 없습니다.")}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <ReportStatusPill status={report.status} />
                    <span className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {formatReportDateTime(report.createdAt)}
                    </span>
                    {report.retryCount > 0 ? (
                      <span className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        재생성 {report.retryCount}회
                      </span>
                    ) : null}
                    {report.failedStep ? (
                      <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                        {getReportFailedStepLabel(report.failedStep)}
                      </span>
                    ) : null}
                  </div>
                </button>

                <div className="flex items-center justify-end gap-2">
                  {report.actionItemCandidates.length ? (
                    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium text-muted-foreground">
                      <ListChecks className="size-3.5" />
                      후보 {report.actionItemCandidates.length}
                    </span>
                  ) : null}
                  {report.status === "FAILED" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={regeneratingReportId === report.id}
                      onClick={() => void handleRegenerateReport(report)}
                    >
                      {regeneratingReportId === report.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <RotateCcw />
                      )}
                      재생성
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid min-h-80 place-items-center text-center">
            <div className="max-w-sm">
              <FileText className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                {searchQuery.trim() || statusFilter !== "ALL"
                  ? "조건에 맞는 회의록이 없습니다."
                  : "아직 회의록이 없습니다."}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                60초 이하 녹음은 회의록이 생성되지 않습니다.
              </p>
            </div>
          </div>
        )}
      </div>

      <MeetingReportDetailSheet
        detailError={detailError}
        detailStatus={detailStatus}
        open={Boolean(selectedReportId)}
        regenerating={
          Boolean(selectedReport?.id) &&
          regeneratingReportId === selectedReport?.id
        }
        report={selectedReport}
        onClose={handleCloseReport}
        onRegenerate={(report) => void handleRegenerateReport(report)}
      />
    </section>
  );
}
