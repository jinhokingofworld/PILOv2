"use client";

import { AlertCircle, Download, Loader2, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
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

import styles from "./document-editor.module.css";

const PdfCollaborationSurface = dynamic(
  () =>
    import("./pdf-collaboration-surface").then(
      (module) => module.PdfCollaborationSurface,
    ),
  { ssr: false },
);

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; previewUrl: string }
  | { status: "error"; message: string };

function messageFromUnknown(error: unknown) {
  return error instanceof Error
    ? error.message
    : "PDF 미리보기를 불러오지 못했습니다.";
}

function triggerDownload(url: string) {
  const link = window.document.createElement("a");
  link.href = url;
  link.rel = "noreferrer";
  link.target = "_blank";
  window.document.body.append(link);
  link.click();
  link.remove();
}

export function PdfPreviewDialog({
  fileId,
  fileName,
  open,
  onOpenChange
}: {
  fileId: string;
  fileName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const driveClient = useMemo(
    () => createDriveApiClient({ accessToken }),
    [accessToken]
  );
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle" });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setPreviewState({ status: "error", message: "로그인이 필요합니다." });
      return;
    }

    setPreviewState({ status: "loading" });
    try {
      const result = await driveClient.createPreviewUrl(workspaceId, fileId);
      setPreviewState({ status: "ready", previewUrl: result.previewUrl });
    } catch (error) {
      setPreviewState({ status: "error", message: messageFromUnknown(error) });
    }
  }, [accessToken, driveClient, fileId, workspaceId]);

  useEffect(() => {
    if (!open) {
      setPreviewState({ status: "idle" });
      setDownloadError(null);
      return;
    }

    void loadPreview();
  }, [loadPreview, open]);

  const handleDownload = useCallback(async () => {
    if (!workspaceId || !accessToken) return;

    setIsDownloading(true);
    setDownloadError(null);
    try {
      const result = await driveClient.createDownloadUrl(workspaceId, fileId);
      triggerDownload(result.downloadUrl);
    } catch (error) {
      setDownloadError(messageFromUnknown(error));
    } finally {
      setIsDownloading(false);
    }
  }, [accessToken, driveClient, fileId, workspaceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh w-dvw max-h-none max-w-none flex-col gap-0 rounded-none border-0 p-0" showCloseButton>
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>{fileName}</DialogTitle>
          <DialogDescription>PDF 미리보기</DialogDescription>
        </DialogHeader>

        <div className={styles.pdfPreviewSurface}>
          {previewState.status === "loading" || previewState.status === "idle" ? (
            <div className={styles.pdfPreviewState}>
              <Loader2 className="animate-spin" />
              PDF를 불러오는 중입니다.
            </div>
          ) : previewState.status === "error" ? (
            <div className={styles.pdfPreviewState}>
              <AlertCircle className="text-destructive" />
              <p>{previewState.message}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadPreview()}>
                <RefreshCw />
                다시 시도
              </Button>
            </div>
          ) : (
            <PdfCollaborationSurface
              fileId={fileId}
              previewUrl={previewState.previewUrl}
              workspaceId={workspaceId}
            />
          )}
        </div>

        <div className="flex justify-end border-t px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={isDownloading} onClick={() => void handleDownload()}>
            {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
            다운로드
          </Button>
        </div>
        {downloadError ? <p className="text-right text-xs text-destructive">{downloadError}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
