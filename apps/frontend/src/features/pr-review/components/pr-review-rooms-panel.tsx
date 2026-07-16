"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Loader2,
  RefreshCcw
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/features/auth";
import { createPrReviewApiClient } from "@/features/pr-review/api/client";
import { PrReviewRoomDeleteButton } from "@/features/pr-review/components/pr-review-room-delete-button";
import { getPrReviewErrorMessage } from "@/features/pr-review/pr-review-error-message";
import {
  getReviewRoomEntrySessionId,
  isReviewRoomAnalyzingNewRevision,
  isVisibleReviewRoom
} from "@/features/pr-review/review-room-visibility";
import type { PrReviewRoom } from "@/features/pr-review/types";
import { cn } from "@/lib/utils";

type ReviewRoomLoadStatus = "loading" | "ready" | "error";

type PrReviewRoomsPanelProps = {
  onEnterReviewSession: (reviewSessionId: string) => void;
};

const REVIEW_ROOM_REFRESH_INTERVAL_MS = 5_000;

export function PrReviewRoomsPanel({
  onEnterReviewSession
}: PrReviewRoomsPanelProps) {
  const router = useRouter();
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken ?? null;
  const apiClient = useMemo(
    () => createPrReviewApiClient({ accessToken }),
    [accessToken]
  );
  const [rooms, setRooms] = useState<PrReviewRoom[]>([]);
  const [loadStatus, setLoadStatus] =
    useState<ReviewRoomLoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!workspaceId) {
      setRooms([]);
      setLoadStatus("ready");
      setLoadError(null);
      return;
    }

    const abortController = new AbortController();
    setLoadStatus((currentStatus) =>
      currentStatus === "ready" ? "ready" : "loading"
    );
    setLoadError(null);

    void apiClient
      .listReviewRooms(workspaceId, { signal: abortController.signal })
      .then((payload) => {
        if (abortController.signal.aborted) {
          return;
        }

        setRooms(payload.rooms.filter(isVisibleReviewRoom));
        setLoadStatus("ready");
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }

        setRooms([]);
        setLoadStatus("error");
        setLoadError(
          getPrReviewErrorMessage(
            error,
            "리뷰 공간을 불러오지 못했습니다."
          )
        );
      });

    return () => abortController.abort();
  }, [apiClient, reloadVersion, workspaceId]);

  const hasAnalyzingRoom = rooms.some(
    (room) => room.analyzingReviewSessionId !== null
  );

  useEffect(() => {
    if (!hasAnalyzingRoom) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setReloadVersion((currentVersion) => currentVersion + 1);
    }, REVIEW_ROOM_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [hasAnalyzingRoom]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <section className="flex flex-col gap-1">
        <p className="text-sm font-medium text-primary">PR Review</p>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">
          리뷰 공간
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          진행 중인 리뷰에 합류하거나 완료된 리뷰를 다시 확인할 수 있습니다.
        </p>
      </section>

      {loadStatus === "loading" ? (
        <ReviewRoomListSkeleton />
      ) : loadStatus === "error" ? (
        <ReviewRoomErrorState
          message={loadError}
          onRetry={() => setReloadVersion((currentVersion) => currentVersion + 1)}
        />
      ) : rooms.length === 0 ? (
        <EmptyReviewRoomState onGoToPullRequests={() => router.push("/pr-review")} />
      ) : (
        <div className="grid gap-3">
          {rooms.map((room) => (
            <ReviewRoomCard
              key={room.id}
              onEnter={() => {
                const reviewSessionId = getReviewRoomEntrySessionId(room);
                if (reviewSessionId) {
                  onEnterReviewSession(reviewSessionId);
                }
              }}
              apiClient={apiClient}
              onDeleted={() => {
                setRooms((currentRooms) =>
                  currentRooms.filter((currentRoom) => currentRoom.id !== room.id)
                );
              }}
              room={room}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewRoomCard({
  apiClient,
  room,
  onDeleted,
  onEnter,
  workspaceId
}: {
  apiClient: ReturnType<typeof createPrReviewApiClient>;
  room: PrReviewRoom;
  onDeleted: () => void;
  onEnter: () => void;
  workspaceId: string;
}) {
  const isCompleted = room.status === "completed";
  const completionLabel = room.completionReason === "merged" ? "병합 완료" : "닫힘";
  const isAnalyzingOnly = Boolean(
    room.analyzingReviewSessionId && !room.currentReviewSessionId
  );
  const isAnalyzingNewRevision = isReviewRoomAnalyzingNewRevision(room);

  return (
    <Card className="rounded-lg">
      <CardHeader className="gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            className={cn(
              isCompleted
                ? "bg-slate-100 text-slate-700"
                : isAnalyzingOnly
                  ? "bg-blue-50 text-blue-700"
                  : "bg-emerald-50 text-emerald-700"
            )}
            variant="outline"
          >
            {isCompleted
              ? completionLabel
              : isAnalyzingOnly
                ? "분석 중"
                : "진행 중"}
          </Badge>
          {isAnalyzingNewRevision ? (
            <Badge className="bg-blue-50 text-blue-700" variant="outline">
              <Loader2 className="animate-spin" />
              새 버전 분석 중
            </Badge>
          ) : null}
        </div>
        <div className="min-w-0 pr-0 md:pr-36">
          <CardTitle className="flex min-w-0 items-start gap-2 text-lg">
            <GitPullRequest className="mt-0.5 size-5 shrink-0 text-primary" />
            <span className="text-primary">#{room.pullRequest.githubNumber}</span>
            <span className="min-w-0 break-words">{room.pullRequest.title}</span>
          </CardTitle>
          <CardDescription className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <GitBranch className="size-3.5 shrink-0" />
              <span className="break-all">
                {room.pullRequest.headBranch ?? "-"} → {room.pullRequest.baseBranch ?? "-"}
              </span>
            </span>
          </CardDescription>
        </div>
        <CardAction className="flex items-center gap-1">
          <PrReviewRoomDeleteButton
            apiClient={apiClient}
            onDeleted={onDeleted}
            reviewRoomId={room.id}
            workspaceId={workspaceId}
          />
          <Button
            aria-label={`PR #${room.pullRequest.githubNumber} GitHub에서 열기`}
            render={<a href={room.pullRequest.githubUrl} rel="noreferrer" target="_blank" />}
            size="icon-sm"
            variant="ghost"
          >
            <ExternalLink className="size-4" />
          </Button>
          <Button onClick={onEnter} type="button">
            {isCompleted
              ? "완료 리뷰 보기"
              : isAnalyzingOnly
                ? "분석 상태 보기"
                : "리뷰 공간 입장"}
            <ArrowRight className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-sm text-muted-foreground">
        <span>
          {isCompleted
            ? `${completionLabel}된 PR의 리뷰는 읽기 전용으로 열립니다.`
            : isAnalyzingOnly
              ? "분석이 끝나면 같은 공간에서 리뷰를 시작할 수 있습니다."
              : isAnalyzingNewRevision
                ? "현재 리뷰 버전으로 입장할 수 있습니다."
                : "다른 참여자와 같은 리뷰 진행 상태를 공유합니다."}
        </span>
        <span>최근 변경 {formatDateTime(room.updatedAt)}</span>
      </CardContent>
    </Card>
  );
}

function ReviewRoomListSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton className="h-40 rounded-lg" key={index} />
      ))}
    </div>
  );
}

function ReviewRoomErrorState({
  message,
  onRetry
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-5">
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertCircle className="size-4" />
        리뷰 공간을 불러오지 못했습니다
      </div>
      <p className="text-sm text-muted-foreground">
        {message ?? "잠시 후 다시 시도해주세요."}
      </p>
      <Button onClick={onRetry} type="button" variant="outline">
        <RefreshCcw className="size-4" />
        다시 시도
      </Button>
    </div>
  );
}

function EmptyReviewRoomState({
  onGoToPullRequests
}: {
  onGoToPullRequests: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <GitPullRequest className="size-5" />
      </span>
      <div>
        <h2 className="font-semibold">표시할 리뷰 공간이 없습니다</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          PR을 선택해 첫 리뷰 공간을 만들어보세요.
        </p>
      </div>
      <Button onClick={onGoToPullRequests} type="button">
        PR 선택으로
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
