"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ExternalLink, GitPullRequest, Loader2, Pencil, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBoardApiClient } from "@/features/board/api/client";
import { BoardIssueAssigneeSelector } from "@/features/board/components/board-issue-assignee-selector";
import type {
  BoardIssueAssigneeOptionPayload,
  BoardIssueDetailPayload,
  BoardIssueState,
  BoardRelatedPullRequestPayload,
  UpdateBoardIssueInput
} from "@/features/board/types";
import {
  haveSameAssigneeLogins,
  startAssigneeEditSession
} from "@/features/board/utils/board-assignee-state";
import {
  formatBoardDateTime,
  formatBoardIssueNumber,
  formatBoardIssueState,
  readBoardAssigneeLogin,
  readBoardLabelColor,
  readBoardLabelName
} from "@/features/board/utils/board-format";
import { cn } from "@/lib/utils";

type BoardIssueSheetProps = {
  accessToken: string;
  boardId: string;
  issueId: string | null;
  onClose: () => void;
  onIssueUpdated?: (issue: BoardIssueDetailPayload) => void;
  workspaceId: string;
};

function readAssigneeLogins(issue: BoardIssueDetailPayload): string[] {
  return issue.assignees
    .map(readBoardAssigneeLogin)
    .filter((login): login is string => Boolean(login));
}

function ProjectFieldValue({
  value
}: {
  value: BoardIssueDetailPayload["projectFields"][number];
}) {
  const displayValue =
    value.textValue ??
    value.singleSelectName ??
    value.iterationTitle ??
    value.dateValue ??
    (typeof value.numberValue === "number" ? String(value.numberValue) : "-");

  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <dt className="text-[18px] font-medium text-muted-foreground">
        {value.fieldName}
      </dt>
      <dd className="mt-1 break-words text-[21px]">{displayValue}</dd>
    </div>
  );
}

export function BoardIssueSheet({
  accessToken,
  boardId,
  issueId,
  onClose,
  onIssueUpdated,
  workspaceId
}: BoardIssueSheetProps) {
  const [issue, setIssue] = useState<BoardIssueDetailPayload | null>(null);
  const [pullRequests, setPullRequests] = useState<
    BoardRelatedPullRequestPayload[]
  >([]);
  const [assigneeOptions, setAssigneeOptions] = useState<
    BoardIssueAssigneeOptionPayload[]
  >([]);
  const [assigneeOptionsStatus, setAssigneeOptionsStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [assigneeOptionsError, setAssigneeOptionsError] = useState<string | null>(
    null
  );
  const [assigneeOptionsRequestKey, setAssigneeOptionsRequestKey] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftState, setDraftState] = useState<BoardIssueState>("open");
  const [draftAssignees, setDraftAssignees] = useState<string[]>([]);
  const boardClient = useMemo(
    () => createBoardApiClient({ accessToken }),
    [accessToken]
  );
  const open = Boolean(issueId);

  function resetDraft(nextIssue: BoardIssueDetailPayload) {
    setDraftTitle(nextIssue.title);
    setDraftBody(nextIssue.body ?? "");
    setDraftState(nextIssue.state ?? "open");
    setDraftAssignees(readAssigneeLogins(nextIssue));
  }

  useEffect(() => {
    let active = true;

    async function loadIssue() {
      if (!open || !issueId || !workspaceId || !boardId || !accessToken) {
        setIssue(null);
        setPullRequests([]);
        setAssigneeOptions([]);
        setAssigneeOptionsStatus("idle");
        setAssigneeOptionsError(null);
        setStatus("idle");
        setError(null);
        setIsEditing(false);
        setSaveError(null);
        return;
      }

      setStatus("loading");
      setIsEditing(false);
      setAssigneeOptions([]);
      setAssigneeOptionsStatus("idle");
      setAssigneeOptionsError(null);
      setError(null);
      setSaveError(null);

      try {
        const [detail, relatedPullRequests] = await Promise.all([
          boardClient.getBoardIssue(workspaceId, boardId, issueId),
          boardClient.listBoardIssuePullRequests(workspaceId, boardId, issueId)
        ]);

        if (!active) return;

        setIssue(detail);
        resetDraft(detail);
        setPullRequests(relatedPullRequests);
        setIsEditing(false);
        setStatus("success");
      } catch (loadError) {
        if (!active) return;

        setIssue(null);
        setPullRequests([]);
        setStatus("error");
        setIsEditing(false);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "이슈 상세를 불러오지 못했습니다."
        );
      }
    }

    void loadIssue();

    return () => {
      active = false;
    };
  }, [accessToken, boardClient, boardId, issueId, open, workspaceId]);

  useEffect(() => {
    let active = true;

    async function loadAssigneeOptions() {
      if (
        !isEditing ||
        !open ||
        !issueId ||
        issue?.id !== issueId ||
        !workspaceId ||
        !boardId ||
        !accessToken ||
        assigneeOptionsStatus !== "idle"
      ) {
        return;
      }

      setAssigneeOptionsStatus("loading");
      setAssigneeOptionsError(null);
      try {
        const options = await boardClient.listBoardIssueAssigneeOptions(
          workspaceId,
          boardId,
          issueId
        );
        if (!active) return;
        setAssigneeOptions(options);
        setAssigneeOptionsStatus("success");
      } catch (loadError) {
        if (!active) return;
        setAssigneeOptions([]);
        setAssigneeOptionsStatus("error");
        setAssigneeOptionsError(
          loadError instanceof Error
            ? loadError.message
            : "담당자 후보를 불러오지 못했습니다."
        );
      }
    }

    void loadAssigneeOptions();

    return () => {
      active = false;
    };
  }, [
    accessToken,
    assigneeOptionsRequestKey,
    boardClient,
    boardId,
    isEditing,
    issue?.id,
    issueId,
    open,
    workspaceId
  ]);

  function handleStartEditing() {
    if (!issue) return;

    const nextSession = startAssigneeEditSession(assigneeOptionsStatus);
    resetDraft(issue);
    setAssigneeOptionsStatus(nextSession.status);
    setAssigneeOptionsError(nextSession.error);
    setSaveError(null);
    setIsEditing(true);
  }

  function handleRetryAssigneeOptions() {
    setAssigneeOptionsStatus("idle");
    setAssigneeOptionsError(null);
    setAssigneeOptionsRequestKey((requestKey) => requestKey + 1);
  }

  async function handleSaveIssue() {
    if (!issue || !issueId) return;

    const title = draftTitle.trim();
    if (!title) {
      setSaveError("제목을 입력해주세요.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const assigneesChanged = !haveSameAssigneeLogins(
        draftAssignees,
        readAssigneeLogins(issue)
      );
      const updateInput: UpdateBoardIssueInput = {
        body: draftBody,
        state: draftState,
        title
      };
      if (assigneeOptionsStatus === "success" && assigneesChanged) {
        updateInput.assignees = draftAssignees;
      }

      const result = await boardClient.updateBoardIssue(
        workspaceId,
        boardId,
        issueId,
        updateInput
      );

      setIssue(result.issue);
      resetDraft(result.issue);
      setIsEditing(false);
      onIssueUpdated?.(result.issue);
    } catch (saveFailure) {
      setSaveError(
        saveFailure instanceof Error
          ? saveFailure.message
          : "이슈를 저장하지 못했습니다."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 backdrop-blur-xs transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(900px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-[1080px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl shadow-slate-950/20 outline-none transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div className="border-b p-5 pr-14">
            <DialogPrimitive.Title className="font-heading text-[27px] font-semibold leading-9">
              이슈 상세
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-[21px] leading-7 text-muted-foreground">
              Board 카드와 연결 가능한 관련 PR 정보를 확인합니다.
            </DialogPrimitive.Description>
          </div>

          <DialogPrimitive.Close
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-4 right-4"
                aria-label="이슈 상세 닫기"
              />
            }
          >
            <X className="size-4" />
          </DialogPrimitive.Close>

          <div
            className="flex-1 overflow-y-auto px-5 py-5"
            data-workspace-follow-board-id={!isEditing ? boardId : undefined}
            data-workspace-follow-issue-id={!isEditing ? issueId ?? undefined : undefined}
            data-workspace-follow-surface={!isEditing ? "board-issue-sheet" : undefined}
          >
          {status === "loading" ? (
            <div className="grid min-h-64 place-items-center text-[21px] text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                이슈 상세를 불러오는 중입니다.
              </span>
            </div>
          ) : status === "error" ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[21px] text-destructive">
              {error}
            </p>
          ) : issue ? (
            <div className="grid gap-5">
              <section className="grid gap-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[18px] font-semibold text-muted-foreground">
                      {formatBoardIssueNumber(issue)} -{" "}
                      {formatBoardIssueState(issue.state)}
                    </p>
                    {isEditing ? (
                      <div className="mt-2 grid gap-2">
                        <label className="grid gap-1 text-[21px] font-medium">
                          제목
                          <Input
                            className="h-[54px] text-[21px] md:text-[21px]"
                            value={draftTitle}
                            disabled={isSaving}
                            onChange={(event) =>
                              setDraftTitle(event.currentTarget.value)
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-[21px] font-medium">
                          상태
                          <select
                            className="h-[54px] rounded-md border bg-background px-3 text-[21px]"
                            value={draftState}
                            disabled={isSaving}
                            onChange={(event) =>
                              setDraftState(
                                event.currentTarget.value as BoardIssueState
                              )
                            }
                          >
                            <option value="open">Open</option>
                            <option value="closed">Closed</option>
                          </select>
                        </label>
                      </div>
                    ) : (
                      <h2 className="mt-1 break-words font-heading text-[30px] font-semibold leading-10">
                        {issue.title}
                      </h2>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {isEditing ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-[48px] text-[19.2px]"
                          disabled={isSaving}
                          onClick={() => {
                            resetDraft(issue);
                            setIsEditing(false);
                            setSaveError(null);
                          }}
                        >
                          <X />
                          취소
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-[48px] text-[19.2px]"
                          disabled={isSaving}
                          onClick={() => void handleSaveIssue()}
                        >
                          {isSaving ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Save />
                          )}
                          저장
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-[48px] text-[19.2px]"
                        onClick={handleStartEditing}
                      >
                        <Pencil />
                        수정
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-[48px] text-[19.2px]"
                      disabled={!issue.htmlUrl}
                      onClick={() =>
                        issue.htmlUrl
                          ? window.open(issue.htmlUrl, "_blank", "noopener")
                          : undefined
                      }
                    >
                      <ExternalLink />
                      GitHub
                    </Button>
                  </div>
                </div>

                {saveError ? (
                  <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-[21px] text-destructive">
                    {saveError}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {issue.labels.map((label) => {
                    const name = readBoardLabelName(label);
                    const color = readBoardLabelColor(label);
                    if (!name) return null;

                    return (
                      <span
                        key={name}
                        className="rounded-full border px-2 py-0.5 text-[18px] font-medium"
                        style={{
                          borderColor: color ?? undefined,
                          color: color ?? undefined
                        }}
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>

                <dl className="grid gap-3 text-[21px] sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-muted-foreground">담당자</dt>
                    <dd className="mt-1">
                      {isEditing ? (
                        <BoardIssueAssigneeSelector
                          disabled={isSaving}
                          error={assigneeOptionsError}
                          onChange={setDraftAssignees}
                          onRetry={handleRetryAssigneeOptions}
                          options={assigneeOptions}
                          status={assigneeOptionsStatus}
                          value={draftAssignees}
                        />
                      ) : (
                        readAssigneeLogins(issue)
                          .map((login) => `@${login}`)
                          .join(", ") || "없음"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">
                      GitHub updated
                    </dt>
                    <dd className="mt-1">
                      {formatBoardDateTime(issue.githubUpdatedAt)}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="grid gap-2">
                <h3 className="font-heading text-[24px] font-semibold leading-8">본문</h3>
                {isEditing ? (
                  <textarea
                    className="min-h-72 resize-y rounded-md border bg-background p-3 text-[21px] leading-9 outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={draftBody}
                    disabled={isSaving}
                    onChange={(event) => setDraftBody(event.currentTarget.value)}
                  />
                ) : (
                  <div className="max-h-[432px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 text-[21px] leading-9">
                    {issue.body || "등록된 본문이 없습니다."}
                  </div>
                )}
              </section>

              {issue.projectFields.length ? (
                <section className="grid gap-2">
                  <h3 className="font-heading text-[24px] font-semibold leading-8">
                    Project fields
                  </h3>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {issue.projectFields.map((field) => (
                      <ProjectFieldValue
                        key={`${field.fieldName}-${field.fieldDataType ?? "unknown"}`}
                        value={field}
                      />
                    ))}
                  </dl>
                </section>
              ) : null}

              <section className="grid gap-2">
                <h3 className="font-heading text-[24px] font-semibold leading-8">관련 PR</h3>
                {pullRequests.length ? (
                  <ul className="grid gap-2">
                    {pullRequests.map((pullRequest) => (
                      <li key={pullRequest.id}>
                        <a
                          className="grid gap-1 rounded-lg border bg-background p-3 transition hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          href={pullRequest.githubUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="line-clamp-2 text-[21px] font-medium">
                              #{pullRequest.githubNumber} {pullRequest.title}
                            </span>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[16.5px] font-semibold",
                                pullRequest.state === "closed"
                                  ? "border-violet-200 bg-violet-50 text-violet-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              )}
                            >
                              {pullRequest.state}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-2 text-[18px] text-muted-foreground">
                            <GitPullRequest className="size-3.5" />
                            {pullRequest.headBranch ?? "-"} {" -> "}
                            {pullRequest.baseBranch ?? "-"} -{" "}
                            {pullRequest.changedFilesCount} files
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-[21px] text-muted-foreground">
                    연결된 PR이 없습니다.
                  </p>
                )}
              </section>
            </div>
          ) : null}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
