"use client";

import {
  AlertCircle,
  ArrowDownWideNarrow,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  FileText,
  ListChecks,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  XCircle
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMeetingReportRealtime,
  type MeetingReportRealtimeEvent
} from "@/features/meeting/hooks/use-meeting-report-realtime";
import type { MeetingWorkspaceData } from "@/features/meeting/hooks/use-meeting-workspace-data";
import type {
  MeetingReportDetail,
  MeetingReportStatus,
  MeetingReportSummary
} from "@/features/meeting/types";
import { cn } from "@/lib/utils";

export type MeetingReportStatusFilter = "ALL" | MeetingReportStatus;

type MeetingReportSectionProps = {
  hasPreviousPage: boolean;
  meetingData: MeetingWorkspaceData;
  nextCursor: string | null;
  onListFiltersChange: (filters: { from: string; q: string; to: string }) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onStatusFilterChange: (status: MeetingReportStatusFilter) => void;
  onToastMessage: (message: string) => void;
  statusFilter: MeetingReportStatusFilter;
};

type ReportDetailStatus = "idle" | "loading" | "success" | "error";

function readInitialMeetingReportId() {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("reportId")?.trim() || null;
}

type ParsedActionItemCandidate = {
  assigneeUserId: string | null;
  description: string | null;
  priority: string | null;
  title: string;
};

type MeetingReportTranscriptSegment = NonNullable<
  MeetingReportDetail["transcriptSegments"]
>[number];

const REPORT_POLL_INTERVAL_MS = 10000;
const CALENDAR_DRAFT_TITLE_MAX_LENGTH = 255;
const CALENDAR_DRAFT_DESCRIPTION_MAX_LENGTH = 1000;
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

function toDayBoundary(value: string, boundary: "start" | "end") {
  if (!value) return "";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  if (boundary === "end") date.setDate(date.getDate() + 1);

  return date.toISOString();
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

function formatCalendarDraftDate(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  const normalizedDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return [
    normalizedDate.getFullYear(),
    String(normalizedDate.getMonth() + 1).padStart(2, "0"),
    String(normalizedDate.getDate()).padStart(2, "0")
  ].join("-");
}

function truncateCalendarDraftValue(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

function buildCalendarDraftHref(
  item: ParsedActionItemCandidate,
  report: MeetingReportDetail
) {
  const params = new URLSearchParams({
    calendarAction: "create",
    color: "#22C55E",
    date: formatCalendarDraftDate(report.createdAt),
    isAllDay: "true",
    title: truncateCalendarDraftValue(
      item.title,
      CALENDAR_DRAFT_TITLE_MAX_LENGTH
    )
  });

  if (item.description) {
    params.set(
      "description",
      truncateCalendarDraftValue(
        item.description,
        CALENDAR_DRAFT_DESCRIPTION_MAX_LENGTH
      )
    );
  }

  return `/calendar?${params.toString()}`;
}

function formatReportTitle(report: Pick<MeetingReportSummary, "createdAt">) {
  return `${formatReportDateTime(report.createdAt)} 회의록`;
}

function ReportParticipantSummary({ report }: { report: MeetingReportSummary }) {
  const summary = report.participantSummary;
  if (!summary || summary.totalCount === 0) return null;
  const names = summary.participants
    .map((participant) => participant.name?.trim() || "이름 없음")
    .join(", ");
  return (
    <span className="text-xs text-muted-foreground">
      참석 {summary.totalCount}명{names ? ` · ${names}` : ""}
      {summary.hasMore ? " 외" : ""}
    </span>
  );
}

function getReportStatusLabel(status: MeetingReportStatus) {
  switch (status) {
    case "PROCESSING":
    case "QUEUED":
      return "생성 대기";
    case "TRANSCRIBING":
      return "음성 변환 중";
    case "SUMMARIZING":
      return "회의록 정리 중";
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
    case "QUEUED":
    case "TRANSCRIBING":
    case "SUMMARIZING":
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
    case "QUEUED":
    case "TRANSCRIBING":
    case "SUMMARIZING":
      return Clock3;
    case "COMPLETED":
      return CheckCircle2;
    case "FAILED":
      return XCircle;
  }
}

function isReportInProgress(status: MeetingReportStatus) {
  return (
    status === "PROCESSING" ||
    status === "QUEUED" ||
    status === "TRANSCRIBING" ||
    status === "SUMMARIZING"
  );
}

function getReportProgress(status: MeetingReportStatus) {
  switch (status) {
    case "PROCESSING":
    case "QUEUED":
      return 20;
    case "TRANSCRIBING":
      return 55;
    case "SUMMARIZING":
      return 85;
    case "COMPLETED":
      return 100;
    case "FAILED":
      return 0;
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

function ReportProgress({ status }: { status: MeetingReportStatus }) {
  if (!isReportInProgress(status)) return null;

  const progress = getReportProgress(status);

  return (
    <div aria-label={getReportStatusLabel(status)} className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{getReportStatusLabel(status)}</span>
        <span>{progress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-amber-100">
        <div
          className="h-full rounded-full bg-amber-500 transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
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

function formatTranscriptTimestamp(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getEvidenceSegments(
  report: MeetingReportDetail,
  sourceType: string,
  sourceIndex: number
) {
  const segmentsById = new Map<string, MeetingReportTranscriptSegment>();
  const seenSegmentIds = new Set<string>();
  const segments: MeetingReportTranscriptSegment[] = [];

  for (const segment of report.transcriptSegments ?? []) {
    segmentsById.set(segment.id, segment);
  }

  for (const evidence of report.evidence ?? []) {
    if (evidence.sourceType !== sourceType || evidence.sourceIndex !== sourceIndex) {
      continue;
    }

    const segment = segmentsById.get(evidence.transcriptSegmentId);
    if (!segment || seenSegmentIds.has(segment.id)) continue;

    seenSegmentIds.add(segment.id);
    segments.push(segment);
  }

  return segments.sort((left, right) => left.segmentIndex - right.segmentIndex);
}

function EvidenceTimeButtons({
  onSelect,
  segments
}: {
  onSelect: (segment: MeetingReportTranscriptSegment) => void;
  segments: MeetingReportTranscriptSegment[];
}) {
  if (!segments.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium text-muted-foreground">근거</span>
      {segments.map((segment) => {
        const timestamp = formatTranscriptTimestamp(segment.startedAtMs);
        return (
          <button
            key={segment.id}
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full border bg-muted/40 px-2 font-medium text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${timestamp} transcript 근거로 이동`}
            onClick={() => onSelect(segment)}
          >
            <Clock3 className="size-3" />
            {timestamp}
          </button>
        );
      })}
    </div>
  );
}

function TranscriptSegmentViewer({
  activeSegmentId,
  onSelect,
  registerSegment,
  segments
}: {
  activeSegmentId: string | null;
  onSelect: (segment: MeetingReportTranscriptSegment) => void;
  registerSegment: (id: string, element: HTMLButtonElement | null) => void;
  segments: MeetingReportTranscriptSegment[];
}) {
  return (
    <section className="grid gap-2">
      <h3 className="font-heading text-base font-semibold">Transcript</h3>
      <ul className="grid gap-2">
        {segments.map((segment) => {
          const isActive = segment.id === activeSegmentId;
          const timestamp = formatTranscriptTimestamp(segment.startedAtMs);
          return (
            <li key={segment.id}>
              <button
                ref={(element) => registerSegment(segment.id, element)}
                type="button"
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "w-full scroll-mt-6 rounded-lg border bg-background p-3 text-left text-sm leading-6 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && "border-primary bg-primary/10 ring-1 ring-primary/30"
                )}
                onClick={() => onSelect(segment)}
              >
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  {timestamp} - {formatTranscriptTimestamp(segment.endedAtMs)}
                </span>
                <span className="whitespace-pre-wrap break-words">{segment.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReportTextBlock({
  emptyLabel,
  evidenceSegments = [],
  onEvidenceSelect,
  title,
  value
}: {
  emptyLabel: string;
  evidenceSegments?: MeetingReportTranscriptSegment[];
  onEvidenceSelect?: (segment: MeetingReportTranscriptSegment) => void;
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
      {onEvidenceSelect ? (
        <EvidenceTimeButtons
          segments={evidenceSegments}
          onSelect={onEvidenceSelect}
        />
      ) : null}
    </section>
  );
}

function MeetingReportDetailModal({
  detailError,
  detailStatus,
  onCreateSchedule,
  onClose,
  onRegenerate,
  open,
  regenerating,
  report
}: {
  detailError: string | null;
  detailStatus: ReportDetailStatus;
  onCreateSchedule: (
    item: ParsedActionItemCandidate,
    report: MeetingReportDetail
  ) => void;
  onClose: () => void;
  onRegenerate: (report: MeetingReportSummary) => void;
  open: boolean;
  regenerating: boolean;
  report: MeetingReportDetail | null;
}) {
  const actionItems = parseActionItemCandidates(
    report?.actionItemCandidates ?? []
  );
  const transcriptSegmentRefs = useRef(
    new Map<string, HTMLButtonElement>()
  );
  const [activeTranscriptSegmentId, setActiveTranscriptSegmentId] = useState<
    string | null
  >(null);
  const transcriptSegments = report?.transcriptSegments ?? [];
  const actionItemsWithEvidence = report
    ? actionItems.map((item, index) => ({
        item,
        index,
        evidenceSegments: getEvidenceSegments(report, "action_item", index)
      }))
    : [];

  useEffect(() => {
    setActiveTranscriptSegmentId(null);
  }, [report?.id, report?.transcriptSegments]);

  function registerTranscriptSegment(
    segmentId: string,
    element: HTMLButtonElement | null
  ) {
    if (element) {
      transcriptSegmentRefs.current.set(segmentId, element);
    } else {
      transcriptSegmentRefs.current.delete(segmentId);
    }
  }

  function selectTranscriptSegment(segment: MeetingReportTranscriptSegment) {
    setActiveTranscriptSegmentId(segment.id);
    const element = transcriptSegmentRefs.current.get(segment.id);
    if (!element) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.focus({ preventScroll: true });
  }

  const summaryEvidence = report ? getEvidenceSegments(report, "summary", 0) : [];
  const discussionEvidence = report
    ? getEvidenceSegments(report, "discussion", 0)
    : [];
  const decisionEvidence = report ? getEvidenceSegments(report, "decision", 0) : [];

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 backdrop-blur-xs transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(988px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-[1080px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl shadow-slate-950/20 outline-none transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div className="border-b p-5 pr-14">
            <DialogPrimitive.Title className="font-heading text-lg font-semibold">
              회의록 상세
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              {report ? formatReportDateTime(report.createdAt) : "불러오는 중"}
            </DialogPrimitive.Description>
          </div>

          <DialogPrimitive.Close
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-4 right-4"
                aria-label="회의록 상세 닫기"
              />
            }
          >
            <X className="size-4" />
          </DialogPrimitive.Close>

          <div className="flex-1 overflow-y-auto px-5 py-5">
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
                      <dt className="font-medium text-muted-foreground">참석자</dt>
                      <dd className="mt-1">
                        <ReportParticipantSummary report={report} />
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
                    isReportInProgress(report.status)
                      ? "회의록을 생성하는 중입니다."
                      : "등록된 요약이 없습니다."
                  }
                  evidenceSegments={summaryEvidence}
                  onEvidenceSelect={selectTranscriptSegment}
                  title="요약"
                  value={report.summary}
                />

                <ReportTextBlock
                  emptyLabel={
                    isReportInProgress(report.status)
                      ? "논의사항을 정리하는 중입니다."
                      : "등록된 논의사항이 없습니다."
                  }
                  evidenceSegments={discussionEvidence}
                  onEvidenceSelect={selectTranscriptSegment}
                  title="논의사항"
                  value={report.discussionPoints}
                />

                <ReportTextBlock
                  emptyLabel={
                    isReportInProgress(report.status)
                      ? "결정사항을 정리하는 중입니다."
                      : "등록된 결정사항이 없습니다."
                  }
                  evidenceSegments={decisionEvidence}
                  onEvidenceSelect={selectTranscriptSegment}
                  title="결정사항"
                  value={report.decisions}
                />

                <section className="grid gap-2">
                  <h3 className="font-heading text-base font-semibold">
                    후속 작업 후보
                  </h3>
                  {actionItems.length ? (
                    <ul className="grid gap-2">
                      {actionItemsWithEvidence.map(
                        ({ evidenceSegments, index, item }) => (
                          <li
                            key={`${item.title}-${index}`}
                            className="grid gap-3 rounded-lg border bg-background p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <div className="min-w-0">
                              <p className="break-words font-medium text-foreground">
                                {item.title}
                              </p>
                              {item.description ? (
                                <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                                  {item.description}
                                </p>
                              ) : null}
                              {evidenceSegments.length ? (
                                <div className="mt-3">
                                  <EvidenceTimeButtons
                                    segments={evidenceSegments}
                                    onSelect={selectTranscriptSegment}
                                  />
                                </div>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                              {item.priority ? (
                                <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                  {getActionPriorityLabel(item.priority)}
                                </span>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                className="bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30"
                                onClick={() => onCreateSchedule(item, report)}
                              >
                                <CalendarPlus className="size-3.5" />
                                일정 생성
                              </Button>
                            </div>
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      등록된 후속 작업 후보가 없습니다.
                    </p>
                  )}
                </section>

                {transcriptSegments.length ? (
                  <TranscriptSegmentViewer
                    activeSegmentId={activeTranscriptSegmentId}
                    registerSegment={registerTranscriptSegment}
                    segments={transcriptSegments}
                    onSelect={selectTranscriptSegment}
                  />
                ) : (
                  <ReportTextBlock
                    emptyLabel={
                      isReportInProgress(report.status)
                        ? "음성 텍스트를 정리하는 중입니다."
                        : "등록된 transcript가 없습니다."
                    }
                    title="Transcript"
                    value={report.transcriptText}
                  />
                )}
              </div>
            ) : null}
          </div>

          {report?.status === "FAILED" ? (
            <div className="mt-auto flex flex-col gap-2 border-t p-4 sm:flex-row sm:justify-end">
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
            </div>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function MeetingReportSection({
  hasPreviousPage,
  meetingData,
  nextCursor,
  onListFiltersChange,
  onNextPage,
  onPreviousPage,
  onStatusFilterChange,
  onToastMessage,
  statusFilter
}: MeetingReportSectionProps) {
  const router = useRouter();
  const {
    accessToken,
    canLoad,
    getMeetingReport,
    regenerateMeetingReport,
    reloadReports,
    reports,
    reportsError,
    reportsStatus
  } = meetingData;
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedReport, setSelectedReport] =
    useState<MeetingReportDetail | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] =
    useState<ReportDetailStatus>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [regeneratingReportId, setRegeneratingReportId] =
    useState<string | null>(null);
  const [initialReportId] = useState(readInitialMeetingReportId);
  const [openedInitialReportId, setOpenedInitialReportId] = useState<
    string | null
  >(null);

  const hasProcessingReport = reports.some((report) =>
    isReportInProgress(report.status)
  );
  const isInitialLoading = reportsStatus === "loading" && reports.length === 0;
  const showError = reportsStatus === "error" && reports.length === 0;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onListFiltersChange({
        from: toDayBoundary(fromDate, "start"),
        q: searchQuery.trim(),
        to: toDayBoundary(toDate, "end")
      });
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [fromDate, onListFiltersChange, searchQuery, toDate]);

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

  useEffect(() => {
    if (
      !canLoad ||
      !initialReportId ||
      openedInitialReportId === initialReportId
    ) {
      return;
    }

    setOpenedInitialReportId(initialReportId);
    setSelectedReportId(initialReportId);
    void loadReportDetail(initialReportId);
  }, [canLoad, initialReportId, loadReportDetail, openedInitialReportId]);

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

  const handleCreateSchedule = useCallback(
    (item: ParsedActionItemCandidate, report: MeetingReportDetail) => {
      router.push(buildCalendarDraftHref(item, report));
    },
    [router]
  );

  useEffect(() => {
    if (
      !canLoad ||
      (!hasProcessingReport || !selectedReport || !isReportInProgress(selectedReport.status))
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void reloadReports();

      if (selectedReportId && selectedReport && isReportInProgress(selectedReport.status)) {
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

  const handleRealtimeReportUpdated = useCallback(
    (event: MeetingReportRealtimeEvent) => {
      void reloadReports();
      if (selectedReportId === event.reportId) {
        void loadReportDetail(selectedReportId, { silent: true });
      }
    },
    [loadReportDetail, reloadReports, selectedReportId]
  );

  useMeetingReportRealtime({
    accessToken,
    enabled: canLoad,
    onReportUpdated: handleRealtimeReportUpdated,
    workspaceId: meetingData.workspaceId
  });

  return (
    <section
      id="report"
      className="grid min-h-[calc(100vh-8rem)] content-start gap-5 rounded-xl border bg-card p-4 sm:p-6"
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

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 rounded-lg border bg-muted/20 p-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="회의록 검색"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <Input
          aria-label="회의록 시작일"
          className="h-9 sm:w-36"
          type="date"
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
        />
        <Input
          aria-label="회의록 종료일"
          className="h-9 sm:w-36"
          type="date"
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
        />

        <div className="hidden h-6 w-px bg-border sm:block" />

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap">
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

      <div className="mx-auto min-h-96 w-full max-w-5xl rounded-lg border bg-muted/20 p-3 sm:p-5">
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
        ) : reports.length ? (
          <ul className="mx-auto grid w-full max-w-4xl gap-3">
            {reports.map((report) => (
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
                      (isReportInProgress(report.status)
                        ? "회의록을 생성하는 중입니다."
                        : "등록된 요약이 없습니다.")}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <ReportStatusPill status={report.status} />
                    <span className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {formatReportDateTime(report.createdAt)}
                    </span>
                    <ReportParticipantSummary report={report} />
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
                  <div className="mt-3">
                    <ReportProgress status={report.status} />
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
                {searchQuery.trim() || fromDate || toDate || statusFilter !== "ALL"
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

      <div className="mx-auto flex w-full max-w-5xl justify-end gap-2">
        <Button
          disabled={reportsStatus === "loading" || !hasPreviousPage}
          type="button"
          variant="outline"
          onClick={onPreviousPage}
        >
          이전
        </Button>
        <Button
          disabled={reportsStatus === "loading" || !nextCursor}
          type="button"
          variant="outline"
          onClick={onNextPage}
        >
          다음
        </Button>
      </div>

      <MeetingReportDetailModal
        detailError={detailError}
        detailStatus={detailStatus}
        open={Boolean(selectedReportId)}
        regenerating={
          Boolean(selectedReport?.id) &&
          regeneratingReportId === selectedReport?.id
        }
        report={selectedReport}
        onCreateSchedule={handleCreateSchedule}
        onClose={handleCloseReport}
        onRegenerate={(report) => void handleRegenerateReport(report)}
      />
    </section>
  );
}
