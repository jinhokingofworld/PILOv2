"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Database,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useAuthSession } from "@/features/auth/auth-session";
import {
  createSqlErdApiClient,
  SqlErdApiError
} from "@/features/sql-erd/api/client";
import type { SqltoerdSessionSummary } from "@/features/sql-erd/types";
import {
  getSqlErdSessionListViewState,
  removeSqlErdSession
} from "@/features/sql-erd/utils/session-list-state";
import { buildSqlErdSessionHref } from "@/features/sql-erd/utils/session-navigation";
import {
  getSqlErdCreateSessionTitle,
  getSqlErdSessionTitleUpdate,
  updateSqlErdSessionSummaryTitle
} from "@/features/sql-erd/utils/session-title";

const SQL_ERD_SESSION_PAGE_LIMIT = 20;

type LoadSqlErdSessionsOptions = {
  append?: boolean;
  cursor?: string | null;
  failureMessage?: string;
};

const emptySqlErdSessionPayload = {
  modelJson: {
    version: 1 as const,
    schema: {
      tables: [],
      relations: []
    }
  },
  layoutJson: {
    version: 1 as const,
    tableLayouts: []
  }
};

function formatUpdatedAt(updatedAt: string) {
  const date = new Date(updatedAt);

  if (Number.isNaN(date.getTime())) {
    return updatedAt;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function SqlErdSessionList() {
  const authSession = useAuthSession();
  const router = useRouter();
  const requestIdRef = useRef(0);
  const [sessions, setSessions] = useState<SqltoerdSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(
    null
  );
  const [editingTitle, setEditingTitle] = useState("");
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const apiClient = useMemo(
    () =>
      authSession
        ? createSqlErdApiClient({ accessToken: authSession.accessToken })
        : null,
    [authSession]
  );

  const loadSessions = useCallback(
    async ({
      append = false,
      cursor = null,
      failureMessage
    }: LoadSqlErdSessionsOptions = {}) => {
      if (!apiClient || !authSession) {
        setIsLoading(false);
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setErrorMessage(null);

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const result = await apiClient.listSessions(
          authSession.activeWorkspaceId,
          {
            cursor,
            limit: SQL_ERD_SESSION_PAGE_LIMIT
          }
        );

        if (requestId !== requestIdRef.current) {
          return;
        }

        setSessions((currentSessions) =>
          append ? [...currentSessions, ...result.items] : result.items
        );
        setNextCursor(result.nextCursor);
        setHasLoadedSessions(true);
      } catch {
        if (requestId === requestIdRef.current) {
          setErrorMessage(
            failureMessage ??
              (append
                ? "다음 session을 불러오지 못했습니다. 다시 시도해 주세요."
                : "Session 목록을 불러오지 못했습니다. 다시 시도해 주세요.")
          );
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [apiClient, authSession]
  );

  useEffect(() => {
    setSessions([]);
    setNextCursor(null);
    setHasLoadedSessions(false);
    void loadSessions();

    return () => {
      requestIdRef.current += 1;
    };
  }, [loadSessions]);

  const handleCreateSession = useCallback(async () => {
    if (!apiClient || !authSession || isCreating) {
      return;
    }

    setIsCreating(true);
    setErrorMessage(null);

    const title = getSqlErdCreateSessionTitle(createTitle);

    try {
      const session = await apiClient.createSession(
        authSession.activeWorkspaceId,
        {
          ...emptySqlErdSessionPayload,
          ...(title ? { title } : {})
        }
      );
      setIsCreateDialogOpen(false);
      setCreateTitle("");
      router.push(buildSqlErdSessionHref(session.id));
    } catch {
      setErrorMessage("새 session을 만들지 못했습니다. 다시 시도해 주세요.");
      setIsCreating(false);
    }
  }, [apiClient, authSession, createTitle, isCreating, router]);

  const handleStartSessionTitleEdit = useCallback(
    (session: SqltoerdSessionSummary) => {
      setEditingSessionId(session.id);
      setEditingTitle(session.title);
      setErrorMessage(null);
    },
    []
  );

  const handleCancelSessionTitleEdit = useCallback(() => {
    if (savingSessionId) {
      return;
    }

    setEditingSessionId(null);
    setEditingTitle("");
  }, [savingSessionId]);

  const handleSaveSessionTitle = useCallback(
    async (session: SqltoerdSessionSummary) => {
      if (!apiClient || !authSession || savingSessionId) {
        return;
      }

      const title = getSqlErdSessionTitleUpdate(editingTitle);

      if (!title) {
        setErrorMessage("Session 제목을 입력해 주세요.");
        return;
      }

      setSavingSessionId(session.id);
      setErrorMessage(null);

      try {
        const updatedSession = await apiClient.updateSessionMetadata(
          authSession.activeWorkspaceId,
          session.id,
          {
            baseRevision: session.revision,
            title
          }
        );

        setSessions((currentSessions) =>
          updateSqlErdSessionSummaryTitle(currentSessions, updatedSession)
        );
        setEditingSessionId(null);
        setEditingTitle("");
      } catch (error) {
        setErrorMessage(
          error instanceof SqlErdApiError && error.status === 409
            ? "Session이 다른 곳에서 변경됐습니다. 목록을 새로고침한 뒤 다시 시도해 주세요."
            : "Session 제목을 변경하지 못했습니다. 다시 시도해 주세요."
        );
      } finally {
        setSavingSessionId(null);
      }
    },
    [apiClient, authSession, editingTitle, savingSessionId]
  );

  const handleDeleteSession = useCallback(
    async (session: SqltoerdSessionSummary) => {
      if (!apiClient || !authSession || deletingSessionId) {
        return;
      }

      if (!window.confirm(`“${session.title}” session을 삭제할까요?`)) {
        return;
      }

      setDeletingSessionId(session.id);
      setErrorMessage(null);

      try {
        await apiClient.deleteSession(
          authSession.activeWorkspaceId,
          session.id,
          session.revision
        );
      } catch (error) {
        setErrorMessage(
          error instanceof SqlErdApiError && error.status === 409
            ? "Session이 다른 곳에서 변경됐습니다. 목록을 새로고침한 뒤 다시 삭제해 주세요."
            : "Session을 삭제하지 못했습니다. 다시 시도해 주세요."
        );
        setDeletingSessionId(null);
        return;
      }

      setSessions((currentSessions) =>
        removeSqlErdSession(currentSessions, session.id)
      );
      setDeletingSessionId(null);
      await loadSessions({
        failureMessage:
          "Session은 삭제됐지만 목록을 갱신하지 못했습니다. 다시 시도해 주세요."
      });
    },
    [apiClient, authSession, deletingSessionId, loadSessions]
  );

  const sessionListViewState = getSqlErdSessionListViewState({
    errorMessage,
    hasLoadedSessions,
    isLoading,
    sessionCount: sessions.length
  });

  return (
    <main className="min-h-screen overflow-auto bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              aria-label="홈으로 이동"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              href="/home"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Database className="size-5 text-blue-600" />
                <h1 className="truncate text-xl font-semibold">
                  SQLtoERD Sessions
                </h1>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Workspace의 ERD session을 선택하거나 새로 만듭니다.
              </p>
            </div>
          </div>
          <button
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!authSession || isCreating}
            onClick={() => setIsCreateDialogOpen(true)}
            type="button"
          >
            {isCreating ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            새 ERD
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        {errorMessage && hasLoadedSessions ? (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>{errorMessage}</p>
            <button
              className="font-medium underline underline-offset-4"
              onClick={() => void loadSessions()}
              type="button"
            >
              목록 새로고침
            </button>
          </div>
        ) : null}

        {sessionListViewState === "loading" ? (
          <div className="flex min-h-72 items-center justify-center rounded-xl border bg-background text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            Session 목록을 불러오는 중입니다.
          </div>
        ) : sessionListViewState === "error" ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-red-200 bg-background px-6 text-center">
            <h2 className="text-lg font-semibold text-red-700">
              Session 목록을 불러오지 못했습니다
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {errorMessage}
            </p>
            <button
              className="mt-5 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              onClick={() => void loadSessions()}
              type="button"
            >
              다시 시도
            </button>
          </div>
        ) : sessionListViewState === "empty" ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed bg-background px-6 text-center">
            <Database className="size-10 text-muted-foreground/60" />
            <h2 className="mt-4 text-lg font-semibold">세션이 없습니다</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              새 ERD를 만들어 SQL DDL을 입력하고 Workspace에 저장해 보세요.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sessions.map((session) => (
              <article
                className="group relative rounded-xl border bg-background p-5 shadow-sm transition-shadow hover:shadow-md"
                key={session.id}
              >
                <Link
                  aria-label={`${session.title} session 열기`}
                  className="absolute inset-0 rounded-xl"
                  href={buildSqlErdSessionHref(session.id)}
                />
                <div className="pointer-events-none relative">
                  <div className="flex items-start justify-between gap-3 pr-9">
                    <div className="pointer-events-auto relative z-10 min-w-0">
                      {editingSessionId === session.id ? (
                        <form
                          className="flex min-w-0 items-center gap-1"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleSaveSessionTitle(session);
                          }}
                        >
                          <input
                            aria-label="Session 제목"
                            autoFocus
                            className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            disabled={savingSessionId === session.id}
                            maxLength={120}
                            onChange={(event) => setEditingTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                handleCancelSessionTitleEdit();
                              }
                            }}
                            value={editingTitle}
                          />
                          <button
                            aria-label="제목 저장"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                            disabled={savingSessionId === session.id}
                            title="제목 저장"
                            type="submit"
                          >
                            {savingSessionId === session.id ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                          </button>
                          <button
                            aria-label="제목 수정 취소"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                            disabled={savingSessionId === session.id}
                            onClick={handleCancelSessionTitleEdit}
                            title="제목 수정 취소"
                            type="button"
                          >
                            <X className="size-4" />
                          </button>
                        </form>
                      ) : (
                        <div className="flex min-w-0 items-center gap-1">
                          <h2 className="truncate font-semibold">{session.title}</h2>
                          <button
                            aria-label={`${session.title} 제목 수정`}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleStartSessionTitleEdit(session);
                            }}
                            title="제목 수정"
                            type="button"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </div>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatUpdatedAt(session.updatedAt)}
                      </p>
                    </div>
                    <span className="rounded-full border bg-muted/40 px-2 py-1 text-[11px] font-medium uppercase text-muted-foreground">
                      {session.dialect}
                    </span>
                  </div>
                  <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-muted/40 p-3">
                      <dt className="text-xs text-muted-foreground">Tables</dt>
                      <dd className="mt-1 font-semibold">
                        {session.tableCount}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <dt className="text-xs text-muted-foreground">
                        Relations
                      </dt>
                      <dd className="mt-1 font-semibold">
                        {session.relationCount}
                      </dd>
                    </div>
                  </dl>
                </div>
                <button
                  aria-label={`${session.title} session 삭제`}
                  className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  disabled={deletingSessionId !== null}
                  onClick={() => void handleDeleteSession(session)}
                  type="button"
                >
                  {deletingSessionId === session.id ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </button>
              </article>
            ))}
          </div>
        )}

        {nextCursor && !isLoading ? (
          <div className="mt-6 flex justify-center">
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium disabled:opacity-50"
              disabled={isLoadingMore}
              onClick={() =>
                void loadSessions({ append: true, cursor: nextCursor })
              }
              type="button"
            >
              {isLoadingMore ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              더 보기
            </button>
          </div>
        ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!isCreating) {
            setIsCreateDialogOpen(open);

            if (!open) {
              setCreateTitle("");
            }
          }
        }}
        open={isCreateDialogOpen}
      >
        <DialogContent className="max-w-md" showCloseButton={!isCreating}>
          <DialogHeader>
            <DialogTitle>새 ERD 만들기</DialogTitle>
            <DialogDescription>
              제목을 비워 두면 기본 제목으로 생성합니다.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateSession();
            }}
          >
            <label className="block space-y-2 text-sm font-medium">
              제목
              <input
                autoFocus
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={isCreating}
                maxLength={120}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="예: 주문 도메인 ERD"
                value={createTitle}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-50"
                disabled={isCreating}
                onClick={() => setIsCreateDialogOpen(false)}
                type="button"
              >
                취소
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={isCreating}
                type="submit"
              >
                {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : null}
                생성
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      </div>
    </main>
  );
}
