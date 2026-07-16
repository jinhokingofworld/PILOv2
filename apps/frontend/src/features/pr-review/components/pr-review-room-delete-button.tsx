"use client";

import { useState } from "react";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type createPrReviewApiClient
} from "@/features/pr-review/api/client";
import { getPrReviewErrorMessage } from "@/features/pr-review/pr-review-error-message";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;

type PrReviewRoomDeleteButtonProps = {
  apiClient: PrReviewApiClient;
  onDeleted: () => void;
  reviewRoomId: string;
  workspaceId: string;
};

export function PrReviewRoomDeleteButton({
  apiClient,
  onDeleted,
  reviewRoomId,
  workspaceId
}: PrReviewRoomDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteReviewRoom() {
    if (!workspaceId || isDeleting) return;

    setIsDeleting(true);
    setError(null);
    try {
      await apiClient.deleteReviewRoom(workspaceId, reviewRoomId);
      setOpen(false);
      onDeleted();
    } catch (deleteError) {
      setError(
        getPrReviewErrorMessage(
          deleteError,
          "리뷰 공간을 삭제하지 못했습니다. 다시 시도해주세요."
        )
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!isDeleting) {
          setOpen(nextOpen);
          if (!nextOpen) setError(null);
        }
      }}
      open={open}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="리뷰 공간 삭제"
              onClick={() => setOpen(true)}
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <Trash2 className="size-4 text-rose-600" />
        </TooltipTrigger>
        <TooltipContent>리뷰 공간 삭제</TooltipContent>
      </Tooltip>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <AlertCircle className="size-5 text-rose-600" />
          </AlertDialogMedia>
          <AlertDialogTitle>리뷰 공간을 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            리뷰 세션, 파일 판단, Review 제출 이력, Canvas 노드와 주석이 모두 영구 삭제됩니다. 현재 이 공간을 보고 있는 팀원도 PR Review 목록으로 이동하며, 이 작업은 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <Button
            disabled={isDeleting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            취소
          </Button>
          <Button
            disabled={isDeleting}
            onClick={() => void deleteReviewRoom()}
            type="button"
            variant="destructive"
          >
            {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            영구 삭제
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
