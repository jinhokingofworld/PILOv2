"use client";

import { FileWarning, Loader2, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { HTMLContainer } from "tldraw";

import { useAuthSession } from "@/features/auth";
import { createCanvasDrivePreviewUrl } from "../../../integrations/drive/canvas-drive-client";
import {
  isCanvasDriveImageMimeType,
  isCanvasDriveTextMimeType,
  normalizeCanvasDriveMimeType,
} from "../../../integrations/drive/canvas-drive-file";
import { useCanvasDriveWorkspaceId } from "../../../integrations/drive/CanvasDriveFileContext";
import type { PiloFileNodeShape } from "./PiloFileNodeShapeTypes";

const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024;
const FILE_NODE_HEADER_HEIGHT = 42;

const PiloFileNodePdfPreview = dynamic(
  () =>
    import("./PiloFileNodePdfPreview").then(
      (module) => module.PiloFileNodePdfPreview,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="pilo-file-node-status">
        <Loader2 className="animate-spin" />
        <span>PDF 렌더러를 불러오는 중입니다.</span>
      </div>
    ),
  },
);

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "image" | "pdf"; url: string }
  | { status: "text"; content: string };

export function PiloFileNodeComponent({
  shape,
}: {
  shape: PiloFileNodeShape;
}) {
  const authSession = useAuthSession();
  const workspaceId = useCanvasDriveWorkspaceId();
  const accessToken = authSession?.accessToken.trim() ?? "";
  const [reloadVersion, setReloadVersion] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const mimeType = normalizeCanvasDriveMimeType(shape.props.mimeType);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPreview() {
      if (!accessToken || !workspaceId || !shape.props.fileId) {
        setPreview({
          status: "error",
          message: "파일 접근 정보를 확인할 수 없습니다.",
        });
        return;
      }

      setPreview({ status: "loading" });

      try {
        const result = await createCanvasDrivePreviewUrl({
          accessToken,
          fileId: shape.props.fileId,
          signal: controller.signal,
          workspaceId,
        });

        if (isCanvasDriveImageMimeType(mimeType)) {
          setPreview({ status: "image", url: result.previewUrl });
          return;
        }

        if (mimeType === "application/pdf") {
          setPreview({ status: "pdf", url: result.previewUrl });
          return;
        }

        if (isCanvasDriveTextMimeType(mimeType)) {
          if (
            typeof result.file.sizeBytes === "number" &&
            result.file.sizeBytes > MAX_INLINE_TEXT_BYTES
          ) {
            throw new Error("2MB 이하의 텍스트 파일만 Canvas에서 미리볼 수 있습니다.");
          }

          const response = await fetch(result.previewUrl, {
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error("텍스트 파일 내용을 불러오지 못했습니다.");
          }

          setPreview({ status: "text", content: await response.text() });
          return;
        }

        throw new Error("Canvas 미리보기를 지원하지 않는 파일 형식입니다.");
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreview({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "파일 미리보기를 불러오지 못했습니다.",
        });
      }
    }

    void loadPreview();
    return () => controller.abort();
  }, [
    accessToken,
    mimeType,
    reloadVersion,
    shape.props.fileId,
    workspaceId,
  ]);

  return (
    <HTMLContainer
      className="pilo-file-node-shape"
      style={{ height: shape.props.h, width: shape.props.w }}
    >
      <header className="pilo-file-node-header">
        <span className="pilo-file-node-name" title={shape.props.fileName}>
          {shape.props.fileName}
        </span>
        <span className="pilo-file-node-type">{mimeType}</span>
      </header>

      <div className="pilo-file-node-preview">
        {preview.status === "loading" ? (
          <div className="pilo-file-node-status">
            <Loader2 className="animate-spin" />
            <span>파일을 불러오는 중입니다.</span>
          </div>
        ) : null}

        {preview.status === "error" ? (
          <div className="pilo-file-node-status is-error">
            <FileWarning />
            <span>{preview.message}</span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setReloadVersion((version) => version + 1)}
            >
              <RefreshCw /> 다시 시도
            </button>
          </div>
        ) : null}

        {preview.status === "image" ? (
          <img
            alt={shape.props.fileName}
            crossOrigin="anonymous"
            draggable={false}
            src={preview.url}
            onError={() =>
              setPreview({
                status: "error",
                message: "이미지 URL이 만료되었거나 파일을 불러오지 못했습니다.",
              })
            }
          />
        ) : null}

        {preview.status === "pdf" ? (
          <PiloFileNodePdfPreview
            fileName={shape.props.fileName}
            height={Math.max(1, shape.props.h - FILE_NODE_HEADER_HEIGHT)}
            url={preview.url}
            width={shape.props.w}
            onError={() =>
              setPreview({
                status: "error",
                message:
                  "PDF URL이 만료되었거나 파일을 표시하지 못했습니다.",
              })
            }
          />
        ) : null}

        {preview.status === "text" ? (
          <pre className="pilo-file-node-code">
            <code>{preview.content}</code>
          </pre>
        ) : null}
      </div>
    </HTMLContainer>
  );
}
