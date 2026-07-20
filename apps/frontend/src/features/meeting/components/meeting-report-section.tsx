"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  ListChecks,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  XCircle
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MeetingApiError } from "@/features/meeting/api/client";
import {
  useMeetingReportRealtime,
  type MeetingReportRealtimeEvent
} from "@/features/meeting/hooks/use-meeting-report-realtime";
import type { MeetingWorkspaceData } from "@/features/meeting/hooks/use-meeting-workspace-data";
import { MeetingReportWorkspaceLocationAdapter } from "@/features/meeting/meeting-workspace-location-adapter";
import { createMeetingReportRequestGuard } from "@/features/meeting/meeting-workspace-location";
import type {
  MeetingReportActionItem,
  MeetingReportActionItemDeliveryInput,
  MeetingReportActionItemDeliveryOptions,
  MeetingReportDetail,
  MeetingReportDecisionItem,
  MeetingReportStatus,
  MeetingReportSummary,
  UpdateMeetingReportContentInput,
  UpdateMeetingReportActionItemInput
} from "@/features/meeting/types";
import {
  hasPiloIssueDeliverySelection,
  hasPiloIssueDeliveryTarget,
  resolvePiloIssueDeliverySelection,
  saveThenDeliverActionItem
} from "@/features/meeting/utils/action-item-delivery-flow";
import { cn } from "@/lib/utils";

export type MeetingReportStatusFilter = "ALL" | MeetingReportStatus;

type MeetingReportSectionProps = {
  currentPage: number;
  hasPreviousPage: boolean;
  meetingData: MeetingWorkspaceData;
  nextCursor: string | null;
  onListFiltersChange: (filters: { from: string; q: string; to: string }) => void;
  onNextPage: () => void;
  onPageChange: (page: number) => void;
  onPreviousPage: () => void;
  onStatusFilterChange: (status: MeetingReportStatusFilter) => void;
  onToastMessage: (message: string) => void;
  statusFilter: MeetingReportStatusFilter;
};

type ReportDetailStatus = "idle" | "loading" | "success" | "error";
type ReportDetailView = "detail" | "transcript";
type ReportSortDirection = "newest" | "oldest";

type MeetingReportTranscriptSegment = NonNullable<
  MeetingReportDetail["evidenceSegments"]
>[number];

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

function getReportRequestErrorMessage(error: unknown) {
  if (error instanceof MeetingApiError && error.status === 404) {
    return "회의록 상세를 찾을 수 없습니다. 삭제되었거나 더 이상 사용할 수 없는 회의록일 수 있습니다.";
  }

  return error instanceof Error
    ? error.message
    : "회의록 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function getReportIdFromLocation() {
  if (typeof window === "undefined") return null;

  const reportId = new URLSearchParams(window.location.search).get("reportId");
  return reportId?.trim() || null;
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


function formatReportTitle(report: Pick<MeetingReportSummary, "createdAt" | "title">) {
  return report.title?.trim() || `${formatReportDateTime(report.createdAt)} 회의록`;
}

function formatActivityEvidenceReference(sourceType: string, sourceIndex: number) {
  const label = {
    summary: "요약",
    discussion: "논의",
    decision: "결정",
    action_item: "후속 작업"
  }[sourceType] ?? sourceType;
  return sourceType === "decision" ? label : `${label} ${sourceIndex + 1}`;
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
  sourceIndex?: number
) {
  const segmentsById = new Map<string, MeetingReportTranscriptSegment>();
  const seenSegmentIds = new Set<string>();
  const segments: MeetingReportTranscriptSegment[] = [];

  for (const segment of report.evidenceSegments ?? []) {
    segmentsById.set(segment.id, segment);
  }

  for (const evidence of report.evidence ?? []) {
    if (
      evidence.sourceType !== sourceType ||
      (sourceIndex !== undefined && evidence.sourceIndex !== sourceIndex)
    ) {
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
            aria-label={`${timestamp} transcript 근거 보기`}
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

function ReportTextBlock({
  asList = false,
  emptyLabel,
  evidenceSegments = [],
  onEvidenceSelect,
  title,
  value
}: {
  asList?: boolean;
  emptyLabel: string;
  evidenceSegments?: MeetingReportTranscriptSegment[];
  onEvidenceSelect?: (segment: MeetingReportTranscriptSegment) => void;
  title: string;
  value: string | null;
}) {
  const listItems = (value ?? "")
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  return (
    <section className="grid gap-2">
      <h3 className="font-heading text-xl font-semibold">{title}</h3>
      <div className="min-h-24 whitespace-pre-wrap break-words rounded-lg border bg-background p-3 text-sm leading-6">
        {asList && listItems.length ? (
          <ul className="list-disc space-y-2 pl-5">
            {listItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        ) : value?.trim() ? (
          value
        ) : (
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

function EditableReportTextBlock({
  asList = false,
  editable,
  emptyLabel,
  evidenceSegments = [],
  onEvidenceSelect,
  onSave,
  saving,
  singleLine = false,
  title,
  value
}: {
  asList?: boolean;
  editable: boolean;
  emptyLabel: string;
  evidenceSegments?: MeetingReportTranscriptSegment[];
  onEvidenceSelect?: (segment: MeetingReportTranscriptSegment) => void;
  onSave: (value: string) => Promise<void>;
  saving: boolean;
  singleLine?: boolean;
  title: string;
  value: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const listItems = (value ?? "")
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const save = async () => {
    const nextValue = draft.trim();
    if (!nextValue) return;
    await onSave(nextValue);
    setEditing(false);
  };

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-xl font-semibold">{title}</h3>
        {editable && !editing ? (
          <Button
            aria-label={`${title} 수정`}
            title={`${title} 수정`}
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="grid gap-2 rounded-lg border bg-muted/20 p-3">
          {singleLine ? (
            <Input
              aria-label={`${title} 수정`}
              disabled={saving}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : (
            <textarea
              aria-label={`${title} 수정`}
              className="min-h-32 rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={saving}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => {
              setDraft(value ?? "");
              setEditing(false);
            }}>
              취소
            </Button>
            <Button type="button" size="sm" disabled={saving || !draft.trim()} onClick={() => void save()}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              저장
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-24 whitespace-pre-wrap break-words rounded-lg border bg-background p-3 text-sm leading-6">
          {asList && listItems.length ? (
            <ul className="list-disc space-y-2 pl-5">
              {listItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
          ) : value?.trim() ? (
            value
          ) : (
            <span className="text-muted-foreground">{emptyLabel}</span>
          )}
        </div>
      )}
      {onEvidenceSelect ? (
        <EvidenceTimeButtons segments={evidenceSegments} onSelect={onEvidenceSelect} />
      ) : null}
    </section>
  );
}

function DecisionItemsBlock({
  editable,
  emptyLabel,
  evidenceForItem,
  onEvidenceSelect,
  onSave,
  saving,
  items
}: {
  editable: boolean;
  emptyLabel: string;
  evidenceForItem: (item: MeetingReportDecisionItem) => MeetingReportTranscriptSegment[];
  onEvidenceSelect: (segment: MeetingReportTranscriptSegment) => void;
  onSave: (item: MeetingReportDecisionItem, text: string) => Promise<void>;
  saving: boolean;
  items: MeetingReportDecisionItem[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <section className="grid gap-2">
      <h3 className="font-heading text-xl font-semibold">결정사항</h3>
      {items.length ? (
        <ul className="grid gap-2">
          {items.map((item) => {
            const editing = editingId === item.id;
            return (
              <li key={item.id} className="grid gap-2 rounded-lg border bg-background p-3 text-sm leading-6">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">결정 {item.sourceIndex + 1}</span>
                  {editable && !editing ? (
                    <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => {
                      setEditingId(item.id);
                      setDraft(item.text);
                    }}>
                      <Pencil /> 수정
                    </Button>
                  ) : null}
                </div>
                {editing ? (
                  <>
                    <textarea
                      aria-label={`결정 ${item.sourceIndex + 1} 수정`}
                      className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={saving}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setEditingId(null)}>취소</Button>
                      <Button type="button" size="sm" disabled={saving || !draft.trim()} onClick={() => void onSave(item, draft.trim()).then(() => setEditingId(null))}>
                        {saving ? <Loader2 className="animate-spin" /> : null}
                        저장
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{item.text}</p>
                )}
                <EvidenceTimeButtons segments={evidenceForItem(item)} onSelect={onEvidenceSelect} />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="min-h-24 rounded-lg border bg-background p-3 text-sm leading-6 text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function getActionItemStatusLabel(status: MeetingReportActionItem["status"]) {
  if (status === "APPROVED") return "승인됨";
  if (status === "DISMISSED") return "반려됨";
  if (status === "DELIVERING") return "생성 중";
  if (status === "DELIVERY_FAILED") return "생성 실패";
  return "검토 대기";
}

function getActionItemDeliveryErrorMessage(errorCode: string | null) {
  if (errorCode === "FORBIDDEN") return "연결된 서비스에 접근할 수 없습니다.";
  if (errorCode === "NOT_FOUND") return "선택한 대상 정보를 찾을 수 없습니다.";
  return "생성에 실패했습니다. 입력을 확인한 뒤 다시 시도해주세요.";
}

function ActionItemReviewCard({
  actionItem,
  actionItemAssignees,
  busy,
  evidenceSegments,
  onDeliver,
  onDismiss,
  onEvidenceSelect,
  onLoadIssueDeliveryOptions,
  onSave
}: {
  actionItem: MeetingReportActionItem;
  actionItemAssignees: MeetingReportDetail["actionItemAssignees"];
  busy: boolean;
  evidenceSegments: MeetingReportTranscriptSegment[];
  onDeliver: (input: MeetingReportActionItemDeliveryInput) => Promise<void>;
  onDismiss: () => void;
  onEvidenceSelect: (segment: MeetingReportTranscriptSegment) => void;
  onLoadIssueDeliveryOptions: () => Promise<MeetingReportActionItemDeliveryOptions>;
  onSave: (body: UpdateMeetingReportActionItemInput) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [deliveryType, setDeliveryType] = useState<"calendar_event" | "pilo_issue">(
    actionItem.deliverySuggestion?.deliveryType ?? "pilo_issue"
  );
  const [title, setTitle] = useState(actionItem.title);
  const [description, setDescription] = useState(actionItem.description);
  const [priority, setPriority] = useState(actionItem.priority);
  const [assigneeUserId, setAssigneeUserId] = useState(actionItem.assignee?.userId ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isAllDay, setIsAllDay] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [issueOptions, setIssueOptions] =
    useState<MeetingReportActionItemDeliveryOptions | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [selectedColumnId, setSelectedColumnId] = useState("");
  const [deliveryOptionsError, setDeliveryOptionsError] = useState<string | null>(null);
  const [loadingIssueOptions, setLoadingIssueOptions] = useState(false);
  const pending = actionItem.status === "PENDING";
  const retryingDelivery = actionItem.status === "DELIVERY_FAILED";
  const selectedBoard = issueOptions?.boards.find((board) => board.id === selectedBoardId);
  const hasIssueDeliveryTarget = issueOptions
    ? hasPiloIssueDeliveryTarget(issueOptions)
    : false;
  const hasIssueDeliverySelection = issueOptions
    ? hasPiloIssueDeliverySelection(
        issueOptions,
        selectedBoardId,
        selectedColumnId
      )
    : false;
  const hasStaleIssueDeliverySelection = Boolean(
    issueOptions &&
    hasIssueDeliveryTarget &&
    (selectedBoardId || selectedColumnId) &&
    !hasIssueDeliverySelection
  );

  useEffect(() => {
    setTitle(actionItem.title);
    setDescription(actionItem.description);
    setPriority(actionItem.priority);
    setAssigneeUserId(actionItem.assignee?.userId ?? "");
    setEditing(false);
    const draft = actionItem.status === "DELIVERY_FAILED" ? actionItem.delivery?.draft : null;
    const suggestion = actionItem.deliverySuggestion;
    if (draft?.deliveryType === "calendar_event") {
      setDeliveryType("calendar_event");
      setStartDate(draft.calendar.startDate);
      setEndDate(draft.calendar.endDate ?? draft.calendar.startDate);
      setIsAllDay(draft.calendar.isAllDay ?? true);
      setStartTime(draft.calendar.startTime ?? "");
      setEndTime(draft.calendar.endTime ?? "");
      return;
    }
    if (draft?.deliveryType === "pilo_issue") {
      setDeliveryType("pilo_issue");
      setSelectedBoardId(draft.issue.boardId);
      setSelectedColumnId(draft.issue.columnId);
      return;
    }
    if (suggestion?.deliveryType === "calendar_event" && suggestion.calendar) {
      setDeliveryType("calendar_event");
      setStartDate(suggestion.calendar.startDate);
      setEndDate(suggestion.calendar.endDate);
      setIsAllDay(suggestion.calendar.isAllDay);
      setStartTime(suggestion.calendar.startTime ?? "");
      setEndTime(suggestion.calendar.endTime ?? "");
      return;
    }
    setDeliveryType("pilo_issue");
    setStartDate("");
    setEndDate("");
    setIsAllDay(true);
    setStartTime("");
    setEndTime("");
    setSelectedBoardId("");
    setSelectedColumnId("");
  }, [actionItem]);

  async function loadIssueDeliveryOptions(
    preferredBoardId = selectedBoardId,
    preferredColumnId = selectedColumnId
  ) {
    setDeliveryOptionsError(null);
    setIssueOptions(null);
    setLoadingIssueOptions(true);
    try {
      const options = await onLoadIssueDeliveryOptions();
      const selection = resolvePiloIssueDeliverySelection(
        options,
        preferredBoardId,
        preferredColumnId
      );
      setIssueOptions(options);
      setSelectedBoardId(selection.boardId);
      setSelectedColumnId(selection.columnId);
    } catch (error) {
      setDeliveryOptionsError(getReportRequestErrorMessage(error));
    } finally {
      setLoadingIssueOptions(false);
    }
  }

  async function selectDeliveryType(nextType: "calendar_event" | "pilo_issue") {
    if (!editing) return;

    setDeliveryType(nextType);
    setDeliveryOptionsError(null);
    if (nextType !== "pilo_issue" || issueOptions || loadingIssueOptions) return;
    await loadIssueDeliveryOptions();
  }

  function changeBoard(boardId: string) {
    setSelectedBoardId(boardId);
    const board = issueOptions?.boards.find((option) => option.id === boardId);
    setSelectedColumnId(board?.columns[0]?.id ?? "");
  }

  async function beginEditing() {
    setEditing(true);
    if (deliveryType === "pilo_issue") {
      await loadIssueDeliveryOptions();
    }
  }

  function getActionItemPatch(): UpdateMeetingReportActionItemInput {
    return {
      title: title.trim(),
      description: description.trim(),
      priority,
      assigneeUserId: assigneeUserId || null
    };
  }

  function hasUnsavedActionItemChanges(patch: UpdateMeetingReportActionItemInput) {
    return (
      patch.title !== actionItem.title ||
      patch.description !== actionItem.description ||
      patch.priority !== actionItem.priority ||
      patch.assigneeUserId !== (actionItem.assignee?.userId ?? null)
    );
  }

  async function submitApproval() {
    const patch = getActionItemPatch();
    if (!patch.title || !patch.description) return;
    let delivery: MeetingReportActionItemDeliveryInput;
    if (deliveryType === "calendar_event") {
      if (!startDate || (!isAllDay && !startTime)) return;
      delivery = {
        deliveryType,
        calendar: {
          title: patch.title,
          description: patch.description,
          isAllDay,
          startDate,
          // Keep the field optional in the UI while remaining compatible with
          // app-server versions that still require endDate in delivery input.
          endDate: endDate || startDate,
          startTime: isAllDay ? null : startTime || null,
          endTime: isAllDay ? null : endTime || null
        }
      };
    } else {
      if (!hasIssueDeliverySelection) return;
      delivery = {
        deliveryType,
        issue: {
          boardId: selectedBoardId,
          columnId: selectedColumnId,
          title: patch.title,
          body: patch.description
        }
      };
    }
    await saveThenDeliverActionItem({
      needsSave: pending && hasUnsavedActionItemChanges(patch),
      save: () => onSave(patch),
      deliver: () => onDeliver(delivery)
    });
  }

  return (
    <li className="grid gap-3 rounded-lg border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {getActionItemStatusLabel(actionItem.status)}
          </span>
          {pending && !editing ? (
            <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {deliveryType === "calendar_event" ? "일정" : "이슈"}
            </span>
          ) : null}
          {pending && editing ? (
            <div aria-label="생성 대상 선택" className="flex rounded-md border bg-background p-0.5">
              <Button type="button" size="sm" variant={deliveryType === "calendar_event" ? "default" : "ghost"} className="h-7 px-2 text-xs" disabled={busy || loadingIssueOptions} onClick={() => void selectDeliveryType("calendar_event")}>
                일정
              </Button>
              <Button type="button" size="sm" variant={deliveryType === "pilo_issue" ? "default" : "ghost"} className="h-7 px-2 text-xs" disabled={busy || loadingIssueOptions} onClick={() => void selectDeliveryType("pilo_issue")}>
                {loadingIssueOptions ? <Loader2 className="animate-spin" /> : null}
                이슈
              </Button>
            </div>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          AI 후보 #{actionItem.sourceIndex + 1}
        </span>
      </div>

      {editing && pending ? (
        <div className="grid gap-2">
          <Input aria-label="후속 작업 제목" disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} />
          <textarea aria-label="후속 작업 설명" className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} value={description} onChange={(event) => setDescription(event.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <select aria-label="우선순위 선택" className="h-9 rounded-md border bg-background px-3 text-sm" disabled={busy} value={priority} onChange={(event) => setPriority(event.target.value as MeetingReportActionItem["priority"])}>
              <option value="LOW">낮음</option><option value="MEDIUM">보통</option><option value="HIGH">높음</option>
            </select>
            <select aria-label="담당자 선택" className="h-9 rounded-md border bg-background px-3 text-sm" disabled={busy} value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)}>
              <option value="">담당자 미지정</option>
              {(actionItemAssignees ?? []).map((assignee) => <option key={assignee.userId} value={assignee.userId}>{assignee.name?.trim() || "이름 없음"}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div>
          <p className="break-words font-medium text-foreground">{actionItem.title}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{actionItem.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">{getActionPriorityLabel(actionItem.priority)} · {actionItem.assignee?.name?.trim() || "담당자 미지정"}</p>
        </div>
      )}

      {!editing && evidenceSegments.length ? (
        <EvidenceTimeButtons segments={evidenceSegments} onSelect={onEvidenceSelect} />
      ) : null}

      {actionItem.delivery ? (
        <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            {actionItem.delivery.deliveryType === "calendar_event" ? "일정" : "Pilo issue"} 전달 · {actionItem.delivery.status}
          </p>
          {actionItem.delivery.calendarEvent ? (
            <p className="mt-1">일정 생성됨: {actionItem.delivery.calendarEvent.title}</p>
          ) : null}
          {actionItem.delivery.piloIssue ? (
            <p className="mt-1">
              Issue 생성됨: {actionItem.delivery.piloIssue.title}
              {actionItem.delivery.piloIssue.columnName
                ? ` · ${actionItem.delivery.piloIssue.columnName}`
                : ""}
            </p>
          ) : null}
          {actionItem.delivery.status === "FAILED" ? (
            <p className="mt-1 text-destructive">
              {getActionItemDeliveryErrorMessage(actionItem.delivery.errorCode)}
            </p>
          ) : null}
          {actionItem.delivery.status === "COMPLETED" &&
          !actionItem.delivery.calendarEvent &&
          !actionItem.delivery.piloIssue ? (
            <p className="mt-1">생성된 대상은 삭제되었거나 더 이상 조회할 수 없습니다.</p>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
          {deliveryType === "calendar_event" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-muted-foreground">
                시작 날짜
                <Input type="date" disabled={busy} value={startDate} onChange={(event) => {
                  const nextStartDate = event.target.value;
                  setEndDate((currentEndDate) => currentEndDate === startDate ? nextStartDate : currentEndDate);
                  setStartDate(nextStartDate);
                }} />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                종료 날짜 (비우면 시작 날짜)
                <Input type="date" disabled={busy} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={isAllDay} disabled={busy} onChange={(event) => setIsAllDay(event.target.checked)} />
                종일 일정
              </label>
              {!isAllDay ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input aria-label="시작 시간" type="time" disabled={busy} value={startTime} onChange={(event) => setStartTime(event.target.value)} />
                  <Input aria-label="종료 시간" type="time" disabled={busy} value={endTime} onChange={(event) => setEndTime(event.target.value)} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {loadingIssueOptions ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  생성 가능한 Board와 Column을 불러오는 중입니다.
                </p>
              ) : issueOptions && !hasIssueDeliveryTarget ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  생성 가능한 대상이 없습니다. GitHub repository 연결과 metadata를 확인하고 ProjectV2 Board를 동기화한 뒤 다시 시도해주세요.
                </p>
              ) : (
                <>
                  <select aria-label="Board 선택" className="h-9 rounded-md border bg-background px-3 text-sm" disabled={busy || retryingDelivery} value={selectedBoardId} onChange={(event) => changeBoard(event.target.value)}>
                    <option value="">Board 선택</option>
                    {issueOptions?.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
                  </select>
                  <select aria-label="Column 선택" className="h-9 rounded-md border bg-background px-3 text-sm" disabled={busy || !selectedBoard || retryingDelivery} value={selectedColumnId} onChange={(event) => setSelectedColumnId(event.target.value)}>
                    <option value="">Column 선택</option>
                    {selectedBoard?.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
                  </select>
                  {hasStaleIssueDeliverySelection ? (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      선택한 Board 또는 Column을 사용할 수 없습니다. GitHub repository 연결과 metadata를 확인하고 ProjectV2 Board와 Column을 동기화한 뒤 다시 시도해주세요.
                    </p>
                  ) : null}
                </>
              )}
              {deliveryOptionsError ? <p className="text-xs text-destructive sm:col-span-2">{deliveryOptionsError}</p> : null}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <EvidenceTimeButtons segments={evidenceSegments} onSelect={onEvidenceSelect} />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>취소</Button>
              <Button type="button" size="sm" disabled={busy || !title.trim() || !description.trim() || (deliveryType === "calendar_event" ? !startDate || (!isAllDay && !startTime) : !hasIssueDeliverySelection)} onClick={() => void submitApproval()}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                승인
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {pending && !editing ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDismiss()}
          >
            반려
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void beginEditing()}>
            수정 & 승인
          </Button>
        </div>
      ) : null}
      {actionItem.status === "DELIVERY_FAILED" ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={busy} onClick={() => void beginEditing()}>
            다시 시도
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function MeetingReportDetailModal({
  detailError,
  detailStatus,
  mutatingActionItemId,
  onDeliverActionItem,
  onClose,
  onDelete,
  onDismissActionItem,
  onLoadIssueDeliveryOptions,
  onRegenerate,
  onRetryActionItemExtraction,
  onUpdateActionItem,
  onUpdateContent,
  open,
  deleting,
  regenerating,
  retryingActionItemExtraction,
  updatingContent,
  report
}: {
  detailError: string | null;
  detailStatus: ReportDetailStatus;
  mutatingActionItemId: string | null;
  onDeliverActionItem: (
    actionItem: MeetingReportActionItem,
    input: MeetingReportActionItemDeliveryInput
  ) => Promise<void>;
  onClose: () => void;
  onDelete: (report: MeetingReportSummary) => void;
  onDismissActionItem: (actionItem: MeetingReportActionItem) => void;
  onLoadIssueDeliveryOptions: (
    actionItem: MeetingReportActionItem
  ) => Promise<MeetingReportActionItemDeliveryOptions>;
  onRegenerate: (report: MeetingReportSummary) => void;
  onRetryActionItemExtraction: (report: MeetingReportSummary) => void;
  onUpdateActionItem: (
    actionItem: MeetingReportActionItem,
    body: UpdateMeetingReportActionItemInput
  ) => Promise<boolean>;
  onUpdateContent: (body: UpdateMeetingReportContentInput) => Promise<void>;
  open: boolean;
  deleting: boolean;
  regenerating: boolean;
  retryingActionItemExtraction: boolean;
  updatingContent: boolean;
  report: MeetingReportDetail | null;
}) {
  const actionItems = report?.actionItems ?? [];
  const [detailView, setDetailView] = useState<ReportDetailView>("detail");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [selectedEvidenceSegment, setSelectedEvidenceSegment] = useState<
    MeetingReportTranscriptSegment | null
  >(null);
  const selectedEvidencePanelRef = useRef<HTMLElement | null>(null);
  const actionItemsWithEvidence = report
    ? actionItems.map((item, index) => ({
        item,
        evidenceSegments: getEvidenceSegments(
          report,
          "action_item",
          item.sourceIndex
        )
      }))
    : [];

  useEffect(() => {
    setDetailView("detail");
    setSelectedEvidenceSegment(null);
    setEditingTitle(false);
    setTitleDraft(report?.title ?? "");
  }, [report?.id, report?.evidenceSegments]);

  useEffect(() => {
    if (!editingTitle) {
      setTitleDraft(report?.title ?? "");
    }
  }, [editingTitle, report?.title]);

  useEffect(() => {
    if (!selectedEvidenceSegment) return;

    const panel = selectedEvidencePanelRef.current;
    if (!panel) return;

    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    panel.focus({ preventScroll: true });
  }, [selectedEvidenceSegment?.id]);

  function selectTranscriptSegment(segment: MeetingReportTranscriptSegment) {
    setSelectedEvidenceSegment(segment);
  }

  function startTitleEdit() {
    if (!report?.canEdit || report.status !== "COMPLETED") return;
    setTitleDraft(report.title ?? "");
    setEditingTitle(true);
  }

  async function saveTitle() {
    if (!report) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) return;

    await onUpdateContent({
      expectedVersion: report.contentVersion,
      title: nextTitle
    });
    setEditingTitle(false);
  }

  const summaryEvidence = report ? getEvidenceSegments(report, "summary") : [];
  const discussionEvidence = report
    ? getEvidenceSegments(report, "discussion")
    : [];
  const decisionEvidence = report ? getEvidenceSegments(report, "decision") : [];
  const decisionItems = report?.decisionItems ?? [];
  const canEditContent = Boolean(report?.canEdit && report.status === "COMPLETED");

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
              {detailView === "transcript" ? "Transcript 전문" : "회의록 상세"}
            </DialogPrimitive.Title>
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

          <div
            className="flex-1 overflow-y-auto px-5 py-5"
            data-workspace-follow-report-id={report?.id}
            data-workspace-follow-surface="meeting-content"
          >
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
            ) : report && detailView === "transcript" ? (
              <section className="grid gap-4">
                <Button
                  type="button"
                  className="justify-self-start"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDetailView("detail")}
                >
                  <ArrowLeft />
                  회의록 상세로 돌아가기
                </Button>
                <div className="grid gap-2">
                  <h2 className="font-heading text-lg font-semibold">Transcript 전문</h2>
                  {report.transcriptText?.trim() ? (
                    <p className="whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-4 text-sm leading-7">
                      {report.transcriptText}
                    </p>
                  ) : (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      표시할 Transcript가 없습니다.
                    </p>
                  )}
                </div>
              </section>
            ) : report ? (
              <div className="grid gap-5">
                <section className="grid gap-4 rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      {editingTitle ? (
                        <form
                          className="flex min-w-0 items-center gap-1"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveTitle();
                          }}
                        >
                          <Input
                            aria-label="회의록 제목 수정"
                            autoFocus
                            className="h-10 min-w-0 text-2xl font-semibold"
                            disabled={updatingContent}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setEditingTitle(false);
                              }
                            }}
                            value={titleDraft}
                          />
                          <Button
                            aria-label="회의록 제목 저장"
                            disabled={updatingContent || !titleDraft.trim()}
                            size="icon-sm"
                            type="submit"
                            variant="ghost"
                          >
                            {updatingContent ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Check />
                            )}
                          </Button>
                          <Button
                            aria-label="회의록 제목 수정 취소"
                            disabled={updatingContent}
                            onClick={() => setEditingTitle(false)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <X />
                          </Button>
                        </form>
                      ) : (
                        <div className="flex min-w-0 items-center gap-2">
                          <h2
                            className="break-words font-heading text-2xl font-semibold"
                            onDoubleClick={startTitleEdit}
                          >
                            {report.title?.trim() || formatReportTitle(report)}
                          </h2>
                          {canEditContent ? (
                            <Button
                              aria-label="회의록 제목 수정"
                              onClick={startTitleEdit}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <Pencil />
                            </Button>
                          ) : null}
                        </div>
                      )}
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

                <EditableReportTextBlock
                  editable={canEditContent}
                  emptyLabel={
                    isReportInProgress(report.status)
                      ? "논의사항을 정리하는 중입니다."
                      : "등록된 논의사항이 없습니다."
                  }
                  evidenceSegments={discussionEvidence}
                  onEvidenceSelect={selectTranscriptSegment}
                  onSave={(discussionPoints) => onUpdateContent({
                    expectedVersion: report.contentVersion,
                    discussionPoints
                  })}
                  saving={updatingContent}
                  title="논의사항"
                  value={report.discussionPoints}
                />

                {decisionItems.length ? (
                  <DecisionItemsBlock
                    editable={canEditContent}
                    emptyLabel={
                      isReportInProgress(report.status)
                        ? "결정사항을 정리하는 중입니다."
                        : "등록된 결정사항이 없습니다."
                    }
                    evidenceForItem={(item) => getEvidenceSegments(report, "decision", item.sourceIndex)}
                    items={decisionItems}
                    onEvidenceSelect={selectTranscriptSegment}
                    onSave={(item, text) => onUpdateContent({
                      expectedVersion: report.contentVersion,
                      decisionItems: [{ id: item.id, text }]
                    })}
                    saving={updatingContent}
                  />
                ) : (
                  <ReportTextBlock
                  asList
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
                )}

                <section className="mt-8 grid gap-3 rounded-xl border bg-muted/20 p-5">
                  <div>
                    <h3 className="font-heading text-xl font-semibold">활동 근거</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Transcript와 별도로 녹음 구간에 기록된 Workspace 활동입니다.
                    </p>
                  </div>
                  {report.activityEvidence?.length ? (
                    <ul className="grid gap-2">
                      {report.activityEvidence.map((activity) => (
                        <li key={activity.id} className="rounded-md border bg-background p-3 text-sm">
                          <p className="text-xs font-semibold text-muted-foreground">
                            {formatReportDateTime(activity.occurredAt)} · {activity.action}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words">{activity.summary}</p>
                          {activity.references.length ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              연결된 산출물: {activity.references.map((reference) => formatActivityEvidenceReference(reference.sourceType, reference.sourceIndex)).join(", ")}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">기록된 활동 근거가 없습니다.</p>
                  )}
                </section>

                <section className="mt-8 grid gap-3 border-t-2 border-border/70 pt-8">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-heading text-xl font-semibold">후속 작업</h3>
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300">
                      ✨ AI 추천
                    </span>
                  </div>
                  {actionItems.length ? (
                    <ul className="grid gap-2">
                      {actionItemsWithEvidence.map(
                        ({ evidenceSegments, item }) => (
                          <ActionItemReviewCard
                            key={item.id}
                            actionItem={item}
                            actionItemAssignees={report.actionItemAssignees}
                            busy={mutatingActionItemId === item.id}
                            evidenceSegments={evidenceSegments}
                            onDeliver={(input) => onDeliverActionItem(item, input)}
                            onDismiss={() => onDismissActionItem(item)}
                            onEvidenceSelect={selectTranscriptSegment}
                            onLoadIssueDeliveryOptions={() => onLoadIssueDeliveryOptions(item)}
                            onSave={(body) => onUpdateActionItem(item, body)}
                          />
                        )
                      )}
                    </ul>
                  ) : report.actionItemExtraction?.status === "FAILED" ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                      <p className="text-destructive">
                        {report.actionItemExtraction.errorMessage ?? "후속 작업을 생성하지 못했습니다."}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={retryingActionItemExtraction}
                        onClick={() => onRetryActionItemExtraction(report)}
                      >
                        {retryingActionItemExtraction ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                        후속 작업 다시 생성
                      </Button>
                    </div>
                  ) : report.actionItemExtraction && ["PENDING", "PUBLISHING", "QUEUED", "PROCESSING"].includes(report.actionItemExtraction.status) ? (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      회의록은 완료되었습니다. 후속 작업을 추출하는 중입니다.
                    </p>
                  ) : (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      검토할 후속 작업이 없습니다.
                    </p>
                  )}
                </section>

                {selectedEvidenceSegment ? (
                  <section
                    ref={selectedEvidencePanelRef}
                    tabIndex={-1}
                    className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-heading text-xl font-semibold">근거 Transcript</h3>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedEvidenceSegment(null)}
                      >
                        닫기
                      </Button>
                    </div>
                    <p className="text-xs font-semibold text-muted-foreground">
                      {formatTranscriptTimestamp(selectedEvidenceSegment.startedAtMs)} - {formatTranscriptTimestamp(selectedEvidenceSegment.endedAtMs)}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {selectedEvidenceSegment.text}
                    </p>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>

          {report ? (
            <div className="mt-auto flex flex-col gap-2 border-t p-4 sm:flex-row sm:justify-end">
              {detailView === "transcript" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDetailView("detail")}
                >
                  <ArrowLeft />
                  회의록 상세로 돌아가기
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDetailView("transcript")}
                >
                  <FileText />
                  Transcript 전문 보기
                </Button>
              )}
              {detailView === "detail" && report.canDelete ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleting}
                  onClick={() => onDelete(report)}
                >
                  {deleting ? <Loader2 className="animate-spin" /> : <X />}
                  회의록 삭제
                </Button>
              ) : null}
              {detailView === "detail" && report.status === "FAILED" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={regenerating || deleting}
                  onClick={() => onRegenerate(report)}
                >
                  {regenerating ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                  재생성 요청
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function MeetingReportSection({
  currentPage,
  hasPreviousPage,
  meetingData,
  nextCursor,
  onListFiltersChange,
  onNextPage,
  onPageChange,
  onPreviousPage,
  onStatusFilterChange,
  onToastMessage,
  statusFilter
}: MeetingReportSectionProps) {
  const {
    accessToken,
    canLoad,
    deleteMeetingReport,
    deliverMeetingReportActionItem,
    dismissMeetingReportActionItem,
    getMeetingReport,
    getMeetingReportActionItemDeliveryOptions,
    regenerateMeetingReport,
    retryMeetingReportActionItemExtraction,
    reloadReports,
    reports,
    reportsError,
    reportsStatus,
    updateMeetingReportActionItem,
    updateMeetingReportContent
  } = meetingData;
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortDirection, setSortDirection] =
    useState<ReportSortDirection>("newest");
  const [selectedReport, setSelectedReport] =
    useState<MeetingReportDetail | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] =
    useState<ReportDetailStatus>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [regeneratingReportId, setRegeneratingReportId] =
    useState<string | null>(null);
  const [retryingActionItemExtractionReportId, setRetryingActionItemExtractionReportId] =
    useState<string | null>(null);
  const [mutatingActionItemId, setMutatingActionItemId] =
    useState<string | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [updatingReportContent, setUpdatingReportContent] = useState(false);
  const openedDeepLinkReportIdRef = useRef<string | null>(null);
  const reportDetailRequestGuardRef = useRef(
    createMeetingReportRequestGuard()
  );

  const hasProcessingReport = reports.some((report) =>
    isReportInProgress(report.status)
  );
  const pageNumbers = Array.from(
    { length: currentPage + (nextCursor ? 1 : 0) },
    (_, index) => index + 1
  );
  const isInitialLoading = reportsStatus === "loading" && reports.length === 0;
  const showError = reportsStatus === "error" && reports.length === 0;
  const sortedReports = useMemo(
    () =>
      [...reports].sort((left, right) => {
        const timeDifference =
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

        if (timeDifference !== 0) {
          return sortDirection === "newest" ? -timeDifference : timeDifference;
        }

        return left.id.localeCompare(right.id);
      }),
    [reports, sortDirection]
  );

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
      const request = reportDetailRequestGuardRef.current.begin(reportId);
      if (!options.silent) {
        setDetailStatus("loading");
      }
      setDetailError(null);

      try {
        const result = await getMeetingReport(reportId);
        if (!reportDetailRequestGuardRef.current.isCurrent(request)) {
          return null;
        }
        setSelectedReport(result.report);
        setDetailStatus("success");
        return result.report;
      } catch (error) {
        if (!reportDetailRequestGuardRef.current.isCurrent(request)) {
          return null;
        }
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
      setSelectedReport({ ...report, transcriptText: null });
      void loadReportDetail(report.id);
    },
    [loadReportDetail]
  );

  const handleOpenReportById = useCallback(
    (reportId: string) => {
      setSelectedReportId(reportId);
      setSelectedReport(null);
      void loadReportDetail(reportId);
    },
    [loadReportDetail]
  );

  useEffect(() => {
    if (!canLoad) return;

    const reportId = getReportIdFromLocation();
    if (!reportId || openedDeepLinkReportIdRef.current === reportId) return;

    openedDeepLinkReportIdRef.current = reportId;
    setSelectedReportId(reportId);
    setSelectedReport(null);
    void loadReportDetail(reportId);
  }, [canLoad, loadReportDetail]);

  const handleCloseReport = useCallback(() => {
    reportDetailRequestGuardRef.current.invalidate();
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

        setSelectedReport({ ...result.report, transcriptText: null });

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

  const handleDeleteReport = useCallback(
    async (report: MeetingReportSummary) => {
      if (!window.confirm("이 회의록을 삭제할까요? 삭제된 회의록은 복구할 수 없습니다.")) {
        return;
      }
      setDeletingReportId(report.id);
      try {
        await deleteMeetingReport(report.id);
        handleCloseReport();
        onToastMessage("회의록을 삭제했습니다.");
      } catch (error) {
        onToastMessage(getReportRequestErrorMessage(error));
      } finally {
        setDeletingReportId(null);
      }
    },
    [deleteMeetingReport, handleCloseReport, onToastMessage]
  );

  const handleRetryActionItemExtraction = useCallback(
    async (report: MeetingReportSummary) => {
      setRetryingActionItemExtractionReportId(report.id);
      try {
        await retryMeetingReportActionItemExtraction(report.id);
        onToastMessage("후속 작업 생성을 다시 요청했습니다.");
        await loadReportDetail(report.id, { silent: true });
      } catch (error) {
        onToastMessage(getReportRequestErrorMessage(error));
      } finally {
        setRetryingActionItemExtractionReportId(null);
      }
    },
    [loadReportDetail, onToastMessage, retryMeetingReportActionItemExtraction]
  );

  const handleDismissActionItem = useCallback(
    async (actionItem: MeetingReportActionItem) => {
      if (!selectedReport) return;
      setMutatingActionItemId(actionItem.id);
      try {
        await dismissMeetingReportActionItem(selectedReport.id, actionItem.id);
        onToastMessage("후속 작업을 반려했습니다.");
        await loadReportDetail(selectedReport.id, { silent: true });
      } catch (error) {
        onToastMessage(getReportRequestErrorMessage(error));
      } finally {
        setMutatingActionItemId(null);
      }
    },
    [
      dismissMeetingReportActionItem,
      loadReportDetail,
      onToastMessage,
      selectedReport
    ]
  );

  const handleUpdateActionItem = useCallback(
    async (
      actionItem: MeetingReportActionItem,
      body: UpdateMeetingReportActionItemInput
    ) => {
      if (!selectedReport) return false;
      setMutatingActionItemId(actionItem.id);
      try {
        await updateMeetingReportActionItem(selectedReport.id, actionItem.id, body);
        await loadReportDetail(selectedReport.id, { silent: true });
        return true;
      } catch (error) {
        onToastMessage(getReportRequestErrorMessage(error));
        return false;
      } finally {
        setMutatingActionItemId(null);
      }
    },
    [loadReportDetail, onToastMessage, selectedReport, updateMeetingReportActionItem]
  );

  const handleUpdateReportContent = useCallback(
    async (body: UpdateMeetingReportContentInput) => {
      if (!selectedReport) return;
      setUpdatingReportContent(true);
      try {
        const result = await updateMeetingReportContent(selectedReport.id, body);
        setSelectedReport(result.report);
        onToastMessage("회의록 내용을 저장했습니다.");
      } catch (error) {
        onToastMessage(
          error instanceof MeetingApiError && error.status === 409
            ? "다른 사용자가 먼저 수정했습니다. 최신 회의록을 다시 불러왔습니다."
            : getReportRequestErrorMessage(error)
        );
        await loadReportDetail(selectedReport.id, { silent: true });
      } finally {
        setUpdatingReportContent(false);
      }
    },
    [loadReportDetail, onToastMessage, selectedReport, updateMeetingReportContent]
  );

  const handleActionItemDelivery = useCallback(
    async (
      actionItem: MeetingReportActionItem,
      input: MeetingReportActionItemDeliveryInput
    ) => {
      if (!selectedReport) return;
      setMutatingActionItemId(actionItem.id);
      try {
        const result = await deliverMeetingReportActionItem(
          selectedReport.id,
          actionItem.id,
          input
        );
        onToastMessage(
          result.status === "COMPLETED"
            ? "후속 작업을 생성하고 승인했습니다."
            : result.status === "LEGACY_APPROVED"
              ? "서버 호환 모드로 기존 승인만 완료했습니다. 대상 생성은 App Server 배포 후 사용할 수 있습니다."
              : "생성에 실패했습니다. 같은 설정으로 다시 시도할 수 있습니다."
        );
        await loadReportDetail(selectedReport.id, { silent: true });
      } catch (error) {
        onToastMessage(getReportRequestErrorMessage(error));
      } finally {
        setMutatingActionItemId(null);
      }
    },
    [deliverMeetingReportActionItem, loadReportDetail, onToastMessage, selectedReport]
  );

  const handleLoadIssueDeliveryOptions = useCallback(
    async (actionItem: MeetingReportActionItem) => {
      if (!selectedReport) {
        throw new Error("회의록 상세를 찾을 수 없습니다.");
      }
      return getMeetingReportActionItemDeliveryOptions(
        selectedReport.id,
        actionItem.id
      );
    },
    [getMeetingReportActionItemDeliveryOptions, selectedReport]
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
      <MeetingReportWorkspaceLocationAdapter
        closeReport={handleCloseReport}
        openReport={handleOpenReportById}
        selectedReportId={selectedReportId}
      />
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

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 rounded-lg border bg-muted/20 p-2 xl:flex-row xl:items-center">
        <div className="grid w-full min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] xl:flex-1">
          <div className="relative min-w-0 xl:min-w-48">
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
            className="h-9 w-full"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <Input
            aria-label="회의록 종료일"
            className="h-9 w-full"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>

        <div className="hidden h-6 w-px bg-border xl:block" />

        <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:shrink-0 xl:flex-nowrap">
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
          <Button
            aria-label={`회의록 정렬: ${sortDirection === "newest" ? "최신순" : "오래된순"}`}
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setSortDirection((current) =>
                current === "newest" ? "oldest" : "newest"
              )
            }
          >
            {sortDirection === "newest" ? (
              <ArrowDownWideNarrow />
            ) : (
              <ArrowUpWideNarrow />
            )}
            {sortDirection === "newest" ? "최신순" : "오래된순"}
          </Button>
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

      <div className="mx-auto w-full max-w-5xl">
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
          <ul className="grid w-full gap-3">
            {sortedReports.map((report) => (
              <li
                key={report.id}
                className="grid gap-4 rounded-lg border bg-background p-5 transition hover:border-primary/30 hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <button
                  type="button"
                  className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => handleOpenReport(report)}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <FileText className="size-5 shrink-0 text-muted-foreground" />
                    <h3 className="truncate font-heading text-2xl font-semibold">
                      {formatReportTitle(report)}
                    </h3>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                    {report.summary?.trim() ||
                      report.errorMessage?.trim() ||
                      (isReportInProgress(report.status)
                        ? "회의록을 생성하는 중입니다."
                        : "등록된 요약이 없습니다.")}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
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
                  <div className="mt-4">
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

      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-2">
        <Button
          disabled={reportsStatus === "loading" || !hasPreviousPage}
          type="button"
          variant="outline"
          onClick={onPreviousPage}
        >
          이전
        </Button>
        {pageNumbers.map((page) => (
          <Button
            key={page}
            aria-current={page === currentPage ? "page" : undefined}
            disabled={reportsStatus === "loading" || page === currentPage}
            type="button"
            variant={page === currentPage ? "default" : "outline"}
            onClick={() => onPageChange(page)}
          >
            {page}
          </Button>
        ))}
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
        deleting={deletingReportId === selectedReport?.id}
        detailError={detailError}
        detailStatus={detailStatus}
        mutatingActionItemId={mutatingActionItemId}
        open={Boolean(selectedReportId)}
        regenerating={
          Boolean(selectedReport?.id) &&
          regeneratingReportId === selectedReport?.id
        }
        retryingActionItemExtraction={
          Boolean(selectedReport?.id) &&
          retryingActionItemExtractionReportId === selectedReport?.id
        }
        updatingContent={updatingReportContent}
        report={selectedReport}
        onDeliverActionItem={handleActionItemDelivery}
        onClose={handleCloseReport}
        onDelete={(report) => void handleDeleteReport(report)}
        onDismissActionItem={(actionItem) =>
          void handleDismissActionItem(actionItem)
        }
        onLoadIssueDeliveryOptions={handleLoadIssueDeliveryOptions}
        onRegenerate={(report) => void handleRegenerateReport(report)}
        onRetryActionItemExtraction={(report) => void handleRetryActionItemExtraction(report)}
        onUpdateActionItem={handleUpdateActionItem}
        onUpdateContent={handleUpdateReportContent}
      />
    </section>
  );
}
