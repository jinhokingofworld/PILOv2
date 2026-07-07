"use client";

import { ExternalLink, GitPullRequest, Loader2, Pencil, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { createBoardApiClient } from "@/features/board/api/client";
import type {
  BoardIssueDetailPayload,
  BoardIssueState,
  BoardRelatedPullRequestPayload
} from "@/features/board/types";
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
      <dt className="text-xs font-medium text-muted-foreground">
        {value.fieldName}
      </dt>
      <dd className="mt-1 break-words text-sm">{displayValue}</dd>
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
  const boardClient = useMemo(
    () => createBoardApiClient({ accessToken }),
    [accessToken]
  );
  const open = Boolean(issueId);

  function resetDraft(nextIssue: BoardIssueDetailPayload) {
    setDraftTitle(nextIssue.title);
    setDraftBody(nextIssue.body ?? "");
    setDraftState(nextIssue.state ?? "open");
  }

  useEffect(() => {
    let active = true;

    async function loadIssue() {
      if (!open || !issueId || !workspaceId || !boardId || !accessToken) {
        setIssue(null);
        setPullRequests([]);
        setStatus("idle");
        setError(null);
        setIsEditing(false);
        setSaveError(null);
        return;
      }

      setStatus("loading");
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
      const result = await boardClient.updateBoardIssue(
        workspaceId,
        boardId,
        issueId,
        {
          body: draftBody,
          state: draftState,
          title
        }
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
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>이슈 상세</SheetTitle>
          <SheetDescription>
            Board 카드와 연결 가능한 관련 PR 정보를 확인합니다.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {status === "loading" ? (
            <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                이슈 상세를 불러오는 중입니다.
              </span>
            </div>
          ) : status === "error" ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : issue ? (
            <div className="grid gap-5">
              <section className="grid gap-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {formatBoardIssueNumber(issue)} -{" "}
                      {formatBoardIssueState(issue.state)}
                    </p>
                    {isEditing ? (
                      <div className="mt-2 grid gap-2">
                        <label className="grid gap-1 text-sm font-medium">
                          제목
                          <Input
                            value={draftTitle}
                            disabled={isSaving}
                            onChange={(event) =>
                              setDraftTitle(event.currentTarget.value)
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-sm font-medium">
                          상태
                          <select
                            className="h-9 rounded-md border bg-background px-3 text-sm"
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
                      <h2 className="mt-1 break-words font-heading text-xl font-semibold">
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
                        onClick={() => {
                          resetDraft(issue);
                          setSaveError(null);
                          setIsEditing(true);
                        }}
                      >
                        <Pencil />
                        수정
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
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
                  <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
                        className="rounded-full border px-2 py-0.5 text-xs font-medium"
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

                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-muted-foreground">담당자</dt>
                    <dd className="mt-1">
                      {issue.assignees
                        .map(readBoardAssigneeLogin)
                        .filter(Boolean)
                        .map((login) => `@${login}`)
                        .join(", ") || "없음"}
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
                <h3 className="font-heading text-base font-semibold">본문</h3>
                {isEditing ? (
                  <textarea
                    className="min-h-48 resize-y rounded-md border bg-background p-3 text-sm leading-6 outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={draftBody}
                    disabled={isSaving}
                    onChange={(event) => setDraftBody(event.currentTarget.value)}
                  />
                ) : (
                  <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 text-sm leading-6">
                    {issue.body || "등록된 본문이 없습니다."}
                  </div>
                )}
              </section>

              {issue.projectFields.length ? (
                <section className="grid gap-2">
                  <h3 className="font-heading text-base font-semibold">
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
                <h3 className="font-heading text-base font-semibold">관련 PR</h3>
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
                            <span className="line-clamp-2 text-sm font-medium">
                              #{pullRequest.githubNumber} {pullRequest.title}
                            </span>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                pullRequest.state === "closed"
                                  ? "border-violet-200 bg-violet-50 text-violet-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              )}
                            >
                              {pullRequest.state}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                  <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    연결된 PR이 없습니다.
                  </p>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
