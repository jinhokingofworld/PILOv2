"use client";

import { Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps
} from "@tiptap/react";
import { AlertCircle, Download, Eye, FileText, Loader2, RefreshCw, Unlink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/features/auth";
import { DriveApiError, createDriveApiClient } from "@/features/drive/api/client";
import type { DriveItem } from "@/features/drive/types";

import styles from "./document-editor.module.css";
import { PdfPreviewDialog } from "./pdf-preview-dialog";

type AttachmentState =
  | { status: "loading" }
  | { status: "ready"; file: DriveItem }
  | { status: "error"; message: string }
  | { status: "unavailable" };

function messageFromUnknown(error: unknown) {
  return error instanceof Error
    ? error.message
    : "첨부 파일을 확인하지 못했습니다.";
}

function isUnavailable(error: unknown) {
  return error instanceof DriveApiError && (error.status === 403 || error.status === 404);
}

function formatFileSize(sizeBytes: number | null) {
  if (sizeBytes === null) return "크기 정보 없음";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
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

function DocumentFileAttachmentView({ node, deleteNode, editor }: NodeViewProps) {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const driveItemId = node.attrs.driveItemId as string;
  const driveClient = useMemo(
    () => createDriveApiClient({ accessToken }),
    [accessToken]
  );
  const [attachmentState, setAttachmentState] = useState<AttachmentState>({ status: "loading" });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const loadAttachment = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setAttachmentState({ status: "unavailable" });
      return;
    }

    setAttachmentState({ status: "loading" });
    try {
      const result = await driveClient.createDownloadUrl(workspaceId, driveItemId);
      setAttachmentState({ status: "ready", file: result.file });
    } catch (error) {
      setAttachmentState(
        isUnavailable(error)
          ? { status: "unavailable" }
          : { status: "error", message: messageFromUnknown(error) }
      );
    }
  }, [accessToken, driveClient, driveItemId, workspaceId]);

  useEffect(() => {
    void loadAttachment();
  }, [loadAttachment]);

  const handleDownload = useCallback(async () => {
    if (!workspaceId || !accessToken) return;

    setIsDownloading(true);
    setDownloadError(null);
    try {
      const result = await driveClient.createDownloadUrl(workspaceId, driveItemId);
      triggerDownload(result.downloadUrl);
    } catch (error) {
      setDownloadError(messageFromUnknown(error));
    } finally {
      setIsDownloading(false);
    }
  }, [accessToken, driveClient, driveItemId, workspaceId]);

  const file = attachmentState.status === "ready" ? attachmentState.file : null;
  const isPdf = file?.mimeType === "application/pdf";

  return (
    <NodeViewWrapper className={styles.fileAttachment} data-drive-file-attachment="true">
      <FileText className={styles.fileAttachmentIcon} />
      <div className={styles.fileAttachmentDetails}>
        {attachmentState.status === "loading" ? (
          <span className={styles.fileAttachmentMuted}>
            <Loader2 className="animate-spin" />
            첨부 파일을 확인하는 중입니다.
          </span>
        ) : attachmentState.status === "unavailable" ? (
          <span className={styles.fileAttachmentUnavailable}>
            <AlertCircle />
            사용할 수 없는 파일
          </span>
        ) : attachmentState.status === "error" ? (
          <span className={styles.fileAttachmentUnavailable}>
            <AlertCircle />
            {attachmentState.message}
          </span>
        ) : (
          <>
            <span className={styles.fileAttachmentName}>{attachmentState.file.name}</span>
            <span className={styles.fileAttachmentMeta}>
              {attachmentState.file.mimeType ?? "알 수 없는 형식"} · {formatFileSize(attachmentState.file.sizeBytes)}
            </span>
            {downloadError ? <span className={styles.fileAttachmentUnavailable}>{downloadError}</span> : null}
          </>
        )}
      </div>
      <div className={styles.fileAttachmentActions}>
        {attachmentState.status === "error" ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="첨부 다시 시도" title="첨부 다시 시도" onClick={() => void loadAttachment()}>
            <RefreshCw />
          </Button>
        ) : null}
        {isPdf ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="PDF 열기" title="PDF 열기" onClick={() => setIsPreviewOpen(true)}>
            <Eye />
          </Button>
        ) : null}
        {file ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="파일 다운로드" title="파일 다운로드" disabled={isDownloading} onClick={() => void handleDownload()}>
            {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
          </Button>
        ) : null}
        {editor.isEditable ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="첨부 제거" title="첨부 제거" onClick={deleteNode}>
            <Unlink />
          </Button>
        ) : null}
      </div>
      {file && isPdf ? (
        <PdfPreviewDialog
          fileId={driveItemId}
          fileName={file.name}
          open={isPreviewOpen}
          onOpenChange={setIsPreviewOpen}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

export const DriveFileAttachment = Node.create({
  name: "driveFileAttachment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      driveItemId: {
        default: null
      }
    };
  },

  parseHTML() {
    return [{ tag: "div[data-drive-file-attachment]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-drive-file-attachment": "true" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocumentFileAttachmentView);
  }
});
