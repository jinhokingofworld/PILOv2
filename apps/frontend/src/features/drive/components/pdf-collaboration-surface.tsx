"use client";

import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Highlighter,
  Loader2,
  PenLine,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { Button } from "@/components/ui/button";

import {
  type PdfCollaborationPoint,
  type PdfCollaborationStroke,
  type PdfCollaborationTool,
  usePdfCollaborationRoom,
} from "../pdf-collaboration";
import styles from "./document-editor.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): PdfCollaborationPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    xRatio: clampRatio((event.clientX - rect.left) / Math.max(rect.width, 1)),
    yRatio: clampRatio((event.clientY - rect.top) / Math.max(rect.height, 1)),
  };
}

function createStrokeId() {
  return globalThis.crypto?.randomUUID?.() ?? `stroke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function findStrokeAtPoint(strokes: PdfCollaborationStroke[], point: PdfCollaborationPoint) {
  const hitRadius = 0.025;
  return strokes.find((stroke) =>
    stroke.points.some((candidate) =>
      Math.hypot(candidate.xRatio - point.xRatio, candidate.yRatio - point.yRatio) <= hitRadius,
    ),
  );
}

function StrokePath({ stroke }: { stroke: PdfCollaborationStroke }) {
  const points = stroke.points.map((point) => `${point.xRatio * 100},${point.yRatio * 100}`).join(" ");
  const isHighlighter = stroke.tool === "highlighter";

  return (
    <>
      <polyline
        fill="none"
        points={points}
        stroke={stroke.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={isHighlighter ? 0.42 : 1}
        strokeWidth={isHighlighter ? 2.8 : 0.7}
      />
      {stroke.points.length === 1 ? (
        <circle
          cx={stroke.points[0].xRatio * 100}
          cy={stroke.points[0].yRatio * 100}
          fill={stroke.color}
          opacity={isHighlighter ? 0.42 : 1}
          r={isHighlighter ? 1.4 : 0.35}
        />
      ) : null}
    </>
  );
}

export function PdfCollaborationSurface({
  fileId,
  previewUrl,
  workspaceId,
}: {
  fileId: string;
  previewUrl: string;
  workspaceId: string;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageWidth, setPageWidth] = useState(720);
  const [tool, setTool] = useState<PdfCollaborationTool>("pen");
  const [draftPoints, setDraftPoints] = useState<PdfCollaborationPoint[]>([]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const draftPointsRef = useRef<PdfCollaborationPoint[] | null>(null);
  const {
    clearPageStrokes,
    commitStroke,
    eraseStroke,
    isConnected,
    pointers,
    presence,
    strokesByPage,
    updatePage,
    updatePointer,
  } = usePdfCollaborationRoom({ fileId, workspaceId });
  const strokes = strokesByPage[pageNumber] ?? [];

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateWidth = () => setPageWidth(Math.max(280, Math.min(860, viewport.clientWidth - 32)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const movePage = useCallback(
    (nextPageNumber: number) => {
      if (!numPages || nextPageNumber < 1 || nextPageNumber > numPages) return;
      setPageNumber(nextPageNumber);
      updatePage(nextPageNumber);
    },
    [numPages, updatePage],
  );

  const finishStroke = useCallback(() => {
    const points = draftPointsRef.current;
    if (!points?.length || tool === "eraser") return;

    commitStroke({ id: createStrokeId(), pageNumber, points, tool });
    draftPointsRef.current = null;
    setDraftPoints([]);
  }, [commitStroke, pageNumber, tool]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const point = pointFromEvent(event);
      updatePointer(pageNumber, point);

      if (tool === "eraser") {
        const matchedStroke = findStrokeAtPoint(strokes, point);
        if (matchedStroke) eraseStroke(pageNumber, matchedStroke.id);
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      draftPointsRef.current = [point];
      setDraftPoints([point]);
    },
    [eraseStroke, pageNumber, strokes, tool, updatePointer],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const point = pointFromEvent(event);
      updatePointer(pageNumber, point);

      const points = draftPointsRef.current;
      if (!points) return;
      const previous = points.at(-1);
      if (previous && Math.hypot(previous.xRatio - point.xRatio, previous.yRatio - point.yRatio) < 0.0015) {
        return;
      }

      const nextPoints = [...points, point];
      draftPointsRef.current = nextPoints;
      setDraftPoints(nextPoints);
    },
    [pageNumber, updatePointer],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      finishStroke();
    },
    [finishStroke],
  );

  return (
    <div className={styles.pdfCollaborationLayout}>
      <div className={styles.pdfCollaborationToolbar}>
        <div className={styles.pdfCollaborationControls}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="이전 페이지"
            title="이전 페이지"
            disabled={pageNumber <= 1}
            onClick={() => movePage(pageNumber - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className={styles.pdfPageCounter}>
            {pageNumber} / {numPages ?? "-"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="다음 페이지"
            title="다음 페이지"
            disabled={!numPages || pageNumber >= numPages}
            onClick={() => movePage(pageNumber + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className={styles.pdfCollaborationControls}>
          <Button
            type="button"
            variant={tool === "pen" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="펜"
            title="펜"
            onClick={() => setTool("pen")}
          >
            <PenLine />
          </Button>
          <Button
            type="button"
            variant={tool === "highlighter" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="형광펜"
            title="형광펜"
            onClick={() => setTool("highlighter")}
          >
            <Highlighter />
          </Button>
          <Button
            type="button"
            variant={tool === "eraser" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="선 지우기"
            title="선 지우기"
            onClick={() => setTool("eraser")}
          >
            <Eraser />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="현재 페이지 낙서 전체 지우기"
            title="현재 페이지 낙서 전체 지우기"
            disabled={strokes.length === 0}
            onClick={() => clearPageStrokes(pageNumber)}
          >
            <Trash2 />
          </Button>
        </div>
        <div className={styles.pdfCollaborationPresence} title={isConnected ? "공동 열람 연결됨" : "공동 열람 연결 중"}>
          <Users />
          {presence.length === 0 ? (
            <span>나만 보고 있음</span>
          ) : (
            presence.slice(0, 3).map((member) => (
              <span key={member.userId} className={styles.pdfCollaborationMember}>
                {member.displayName} {member.pageNumber}p
              </span>
            ))
          )}
        </div>
      </div>

      <div ref={viewportRef} className={styles.pdfCollaborationViewport}>
        <div className={styles.pdfPageFrame} style={{ width: pageWidth }}>
          <Document
            file={previewUrl}
            loading={
              <div className={styles.pdfPreviewState}>
                <Loader2 className="animate-spin" />
                PDF를 불러오는 중입니다.
              </div>
            }
            error={<div className={styles.pdfPreviewState}>PDF를 표시하지 못했습니다. 다시 열어주세요.</div>}
            onLoadSuccess={({ numPages: nextNumPages }) => {
              setNumPages(nextNumPages);
              if (pageNumber > nextNumPages) movePage(nextNumPages);
            }}
          >
            <Page
              pageNumber={pageNumber}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              width={pageWidth}
            />
          </Document>
          <svg
            className={styles.pdfAnnotationLayer}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-label="PDF 임시 낙서"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {strokes.map((stroke) => <StrokePath key={stroke.id} stroke={stroke} />)}
            {draftPoints.length > 0 && tool !== "eraser" ? (
              <StrokePath
                stroke={{
                  color: tool === "highlighter" ? "#facc15" : "#111827",
                  id: "draft",
                  pageNumber,
                  points: draftPoints,
                  tool,
                }}
              />
            ) : null}
          </svg>
          {pointers
            .filter((pointer) => pointer.pageNumber === pageNumber)
            .map((pointer) => (
              <span
                key={pointer.userId}
                className={styles.pdfRemotePointer}
                style={{ left: `${pointer.xRatio * 100}%`, top: `${pointer.yRatio * 100}%` }}
              >
                {pointer.displayName}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
