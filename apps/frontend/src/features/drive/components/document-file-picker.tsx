"use client";

import { AlertCircle, ChevronRight, FileText, Folder, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useAuthSession } from "@/features/auth";
import { createDriveApiClient } from "@/features/drive/api/client";
import type { DriveItem, DriveListPayload } from "@/features/drive/types";

type PickerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: DriveListPayload };

function messageFromUnknown(error: unknown) {
  return error instanceof Error
    ? error.message
    : "파일 목록을 불러오지 못했습니다.";
}

export function DocumentFilePicker({
  open,
  onOpenChange,
  onSelect
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (file: DriveItem) => void;
}) {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const driveClient = useMemo(
    () => createDriveApiClient({ accessToken }),
    [accessToken]
  );
  const [folderId, setFolderId] = useState<string | null>(null);
  const [pickerState, setPickerState] = useState<PickerState>({ status: "idle" });

  const loadItems = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setPickerState({ status: "error", message: "로그인이 필요합니다." });
      return;
    }

    setPickerState({ status: "loading" });
    try {
      const payload = await driveClient.listItems(
        workspaceId,
        folderId ? { parentId: folderId } : {}
      );
      setPickerState({ status: "ready", payload });
    } catch (error) {
      setPickerState({ status: "error", message: messageFromUnknown(error) });
    }
  }, [accessToken, driveClient, folderId, workspaceId]);

  useEffect(() => {
    if (open) void loadItems();
  }, [loadItems, open]);

  const payload = pickerState.status === "ready" ? pickerState.payload : null;
  const folders = payload?.items.filter((item) => item.itemType === "folder") ?? [];
  const files =
    payload?.items.filter(
      (item) => item.itemType === "file" && item.uploadStatus === "ready"
    ) ?? [];

  const selectFile = (file: DriveItem) => {
    onSelect(file);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>Drive 파일 첨부</DialogTitle>
          <DialogDescription>같은 Workspace의 준비된 파일만 문서에 첨부할 수 있습니다.</DialogDescription>
        </DialogHeader>

        {payload ? (
          <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <Button type="button" variant="ghost" size="sm" onClick={() => setFolderId(null)}>
              내 파일
            </Button>
            {payload.breadcrumbs.map((breadcrumb) => (
              <div key={breadcrumb.id} className="flex items-center gap-1">
                <ChevronRight className="size-3.5" />
                <Button type="button" variant="ghost" size="sm" onClick={() => setFolderId(breadcrumb.id)}>
                  {breadcrumb.name}
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="max-h-[min(24rem,calc(100vh-15rem))] overflow-y-auto">
          {pickerState.status === "loading" || pickerState.status === "idle" ? (
            <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" />
              파일을 불러오는 중입니다.
            </div>
          ) : pickerState.status === "error" ? (
            <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <AlertCircle className="size-5 text-destructive" />
              <p>{pickerState.message}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadItems()}>
                <RefreshCw />
                다시 시도
              </Button>
            </div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="flex min-h-36 items-center justify-center text-sm text-muted-foreground">
              첨부할 준비된 파일이 없습니다.
            </div>
          ) : (
            <div className="space-y-1">
              {folders.map((folder) => (
                <Button
                  key={folder.id}
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setFolderId(folder.id)}
                >
                  <Folder className="text-amber-600" />
                  <span className="min-w-0 truncate">{folder.name}</span>
                </Button>
              ))}
              {files.map((file) => (
                <Button
                  key={file.id}
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => selectFile(file)}
                >
                  <FileText className="text-muted-foreground" />
                  <span className="min-w-0 truncate">{file.name}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
