"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BoardIssueCreateForm } from "@/features/board/components/board-issue-create-form";
import type {
  BoardColumnPayload,
  CreateBoardIssueInput
} from "@/features/board/types";

type BoardIssueCreateDialogProps = {
  columns: BoardColumnPayload[];
  disabled?: boolean;
  error?: string | null;
  isCreating?: boolean;
  onClose: () => void;
  onCreateIssue: (
    input: CreateBoardIssueInput
  ) => Promise<boolean | void> | boolean | void;
  open: boolean;
};

export function BoardIssueCreateDialog({
  columns,
  disabled = false,
  error = null,
  isCreating = false,
  onClose,
  onCreateIssue,
  open
}: BoardIssueCreateDialogProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 backdrop-blur-xs transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(720px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-[720px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl shadow-slate-950/20 outline-none transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div className="border-b p-5 pr-14">
            <DialogPrimitive.Title className="font-heading text-lg font-semibold">
              새 이슈
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              Board에 새 GitHub 이슈를 추가합니다.
            </DialogPrimitive.Description>
          </div>

          <DialogPrimitive.Close
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-4 right-4"
                disabled={isCreating}
                aria-label="새 이슈 닫기"
              />
            }
          >
            <X className="size-4" />
          </DialogPrimitive.Close>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <BoardIssueCreateForm
              columns={columns}
              disabled={disabled}
              error={error}
              isCreating={isCreating}
              onCreateIssue={onCreateIssue}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
