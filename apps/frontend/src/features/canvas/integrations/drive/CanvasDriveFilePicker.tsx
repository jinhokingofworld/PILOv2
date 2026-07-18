"use client";

import {
  AlertCircle,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CanvasDriveFileReference } from "./canvas-drive-file";
import { isCanvasDrivePreviewMimeType } from "./canvas-drive-file";
import {
  listCanvasDriveItems,
  type CanvasDriveListPayload,
} from "./canvas-drive-client";

type PickerState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: CanvasDriveListPayload };

export function CanvasDriveFilePicker({
  accessToken,
  onOpenChange,
  onSelect,
  open,
  workspaceId,
}: {
  accessToken: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (file: CanvasDriveFileReference) => void;
  open: boolean;
  workspaceId: string;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [state, setState] = useState<PickerState>({ status: "idle" });

  const loadItems = useCallback(
    async (signal?: AbortSignal) => {
      if (!accessToken || !workspaceId) {
        setState({ status: "error", message: "로그인이 필요합니다." });
        return;
      }

      setState({ status: "loading" });
      try {
        const payload = await listCanvasDriveItems({
          accessToken,
          folderId,
          signal,
          workspaceId,
        });
        setState({ status: "ready", payload });
      } catch (error) {
        if (signal?.aborted) return;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Drive 파일을 불러오지 못했습니다.",
        });
      }
    },
    [accessToken, folderId, workspaceId],
  );

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    void loadItems(controller.signal);
    return () => controller.abort();
  }, [loadItems, open]);

  const payload = state.status === "ready" ? state.payload : null;
  const folders = useMemo(
    () => payload?.items.filter((item) => item.itemType === "folder") ?? [],
    [payload],
  );
  const files = useMemo(
    () =>
      payload?.items.filter(
        (item) => item.itemType === "file" && item.uploadStatus === "ready",
      ) ?? [],
    [payload],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>Canvas에 Drive 파일 추가</DialogTitle>
          <DialogDescription>
            이미지, PDF, 텍스트 파일은 원본과 연결된 상태로 표시됩니다.
          </DialogDescription>
        </DialogHeader>

        {payload ? (
          <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <Button type="button" variant="ghost" size="sm" onClick={() => setFolderId(null)}>
              내 파일
            </Button>
            {payload.breadcrumbs.map((breadcrumb) => (
              <div key={breadcrumb.id} className="flex items-center gap-1">
                <ChevronRight className="size-3.5" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFolderId(breadcrumb.id)}
                >
                  {breadcrumb.name}
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="max-h-[min(24rem,calc(100vh-15rem))] overflow-y-auto">
          {state.status === "idle" || state.status === "loading" ? (
            <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" />
              파일을 불러오는 중입니다.
            </div>
          ) : state.status === "error" ? (
            <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <AlertCircle className="size-5 text-destructive" />
              <p>{state.message}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadItems()}>
                <RefreshCw />
                다시 시도
              </Button>
            </div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="flex min-h-36 items-center justify-center text-sm text-muted-foreground">
              표시할 수 있는 파일이 없습니다.
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
              {files.map((file) => {
                const supported = Boolean(
                  file.mimeType && isCanvasDrivePreviewMimeType(file.mimeType),
                );

                return (
                  <Button
                    key={file.id}
                    type="button"
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={!supported || !file.mimeType}
                    title={supported ? undefined : "Canvas 미리보기를 지원하지 않는 형식입니다."}
                    onClick={() => {
                      if (!file.mimeType) return;
                      onSelect({
                        fileId: file.id,
                        fileName: file.name,
                        mimeType: file.mimeType,
                      });
                      onOpenChange(false);
                    }}
                  >
                    <FileText className="text-muted-foreground" />
                    <span className="min-w-0 truncate">{file.name}</span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
