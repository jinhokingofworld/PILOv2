"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const DEFAULT_PAGE_ASPECT_RATIO = 1 / Math.sqrt(2);
const PDF_PREVIEW_HORIZONTAL_PADDING = 16;
const PDF_PREVIEW_VERTICAL_PADDING = 12;
const PDF_PAGE_CONTROLS_HEIGHT = 34;

export function PiloFileNodePdfPreview({
  fileName,
  height,
  onError,
  url,
  width,
}: {
  fileName: string;
  height: number;
  onError: () => void;
  url: string;
  width: number;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageAspectRatio, setPageAspectRatio] = useState(
    DEFAULT_PAGE_ASPECT_RATIO,
  );

  useEffect(() => {
    setNumPages(null);
    setPageNumber(1);
    setPageAspectRatio(DEFAULT_PAGE_ASPECT_RATIO);
  }, [url]);

  const pageWidth = useMemo(() => {
    const availableWidth = Math.max(
      1,
      width - PDF_PREVIEW_HORIZONTAL_PADDING,
    );
    const availableHeight = Math.max(
      1,
      height - PDF_PAGE_CONTROLS_HEIGHT - PDF_PREVIEW_VERTICAL_PADDING,
    );

    return Math.max(
      1,
      Math.min(availableWidth, availableHeight * pageAspectRatio),
    );
  }, [height, pageAspectRatio, width]);

  const movePage = (nextPageNumber: number) => {
    if (
      !numPages ||
      nextPageNumber < 1 ||
      nextPageNumber > numPages
    ) {
      return;
    }
    setPageNumber(nextPageNumber);
  };

  return (
    <div className="pilo-file-node-pdf">
      <div
        className="pilo-file-node-pdf-viewport"
        aria-label={`${fileName} PDF 미리보기`}
      >
        <Document
          file={url}
          loading={
            <div className="pilo-file-node-pdf-state">
              <Loader2 className="animate-spin" />
              <span>PDF를 불러오는 중입니다.</span>
            </div>
          }
          error={
            <div className="pilo-file-node-pdf-state">
              PDF를 표시하지 못했습니다.
            </div>
          }
          onLoadError={onError}
          onLoadSuccess={({ numPages: nextNumPages }) => {
            setNumPages(nextNumPages);
            setPageNumber((currentPageNumber) =>
              Math.min(currentPageNumber, nextNumPages),
            );
          }}
        >
          <Page
            pageNumber={pageNumber}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            width={pageWidth}
            onLoadSuccess={(page) => {
              const viewport = page.getViewport({ scale: 1 });
              if (viewport.height > 0) {
                setPageAspectRatio(viewport.width / viewport.height);
              }
            }}
            onRenderError={onError}
          />
        </Document>
      </div>

      <div
        className="pilo-file-node-pdf-controls"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="이전 페이지"
          disabled={pageNumber <= 1}
          onClick={() => movePage(pageNumber - 1)}
        >
          <ChevronLeft />
        </button>
        <span aria-live="polite">
          {pageNumber} / {numPages ?? "-"}
        </span>
        <button
          type="button"
          aria-label="다음 페이지"
          disabled={!numPages || pageNumber >= numPages}
          onClick={() => movePage(pageNumber + 1)}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
