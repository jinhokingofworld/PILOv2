"use client";

import {
  Circle,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Highlighter,
  Loader2,
  Minus,
  PenLine,
  Plus,
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

const PDF_STROKE_COLORS = [
  { label: "Black", value: "#111827" },
  { label: "Blue", value: "#2563eb" },
  { label: "Red", value: "#dc2626" },
  { label: "Green", value: "#16a34a" },
  { label: "Yellow", value: "#facc15" },
] as const;

const PEN_WIDTHS = [0.7, 1.2, 1.8] as const;
const HIGHLIGHTER_WIDTHS = [2.8, 4.2, 5.6] as const;

function findStrokesAtPoint(strokes: PdfCollaborationStroke[], point: PdfCollaborationPoint) {
  const hitRadius = 0.025;
  return strokes.filter((stroke) =>
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
        strokeWidth={stroke.width}
      />
      {stroke.points.length === 1 ? (
        <circle
          cx={stroke.points[0].xRatio * 100}
          cy={stroke.points[0].yRatio * 100}
          fill={stroke.color}
          opacity={isHighlighter ? 0.42 : 1}
          r={stroke.width / 2}
        />
      ) : null}
    </>
  );
}

export function PdfCollaborationSurface({
  fileId,
  fileName,
  mimeType,
  previewUrl,
  workspaceId,
}: {
  fileId: string;
  fileName: string;
  mimeType: string | null;
  previewUrl: string;
  workspaceId: string;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageWidth, setPageWidth] = useState(720);
  const [tool, setTool] = useState<PdfCollaborationTool>("pen");
  const [penColor, setPenColor] = useState("#111827");
  const [highlighterColor, setHighlighterColor] = useState("#facc15");
  const [penWidth, setPenWidth] = useState<number>(0.7);
  const [highlighterWidth, setHighlighterWidth] = useState<number>(2.8);
  const [draftPoints, setDraftPoints] = useState<PdfCollaborationPoint[]>([]);
  const [hasImageError, setHasImageError] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const draftPointsRef = useRef<PdfCollaborationPoint[] | null>(null);
  const erasedStrokeIdsRef = useRef<Set<string> | null>(null);
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
  const activeColor = tool === "highlighter" ? highlighterColor : penColor;
  const activeWidth = tool === "highlighter" ? highlighterWidth : penWidth;
  const widthOptions = tool === "highlighter" ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;
  const isPdf = mimeType === "application/pdf";

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateWidth = () => setPageWidth(Math.max(280, Math.min(860, viewport.clientWidth - 32)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setHasImageError(false);
  }, [previewUrl]);

  const movePage = useCallback(
    (nextPageNumber: number) => {
      if (!numPages || nextPageNumber < 1 || nextPageNumber > numPages) return;
      setPageNumber(nextPageNumber);
      updatePage(nextPageNumber);
    },
    [numPages, updatePage],
  );

  useEffect(() => {
    if (!isPdf) return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select, [contenteditable='true']") ||
          target.closest("[role='menu'], [role='listbox']"))
      ) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        movePage(pageNumber - 1);
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        movePage(pageNumber + 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPdf, movePage, pageNumber]);

  const finishStroke = useCallback(() => {
    const points = draftPointsRef.current;
    if (!points?.length || tool === "eraser") return;

    commitStroke({
      color: activeColor,
      id: createStrokeId(),
      pageNumber,
      points,
      tool,
      width: activeWidth,
    });
    draftPointsRef.current = null;
    setDraftPoints([]);
  }, [activeColor, activeWidth, commitStroke, pageNumber, tool]);

  const eraseAtPoint = useCallback(
    (point: PdfCollaborationPoint) => {
      const erasedStrokeIds = erasedStrokeIdsRef.current;
      if (!erasedStrokeIds) return;

      for (const stroke of findStrokesAtPoint(strokes, point)) {
        if (erasedStrokeIds.has(stroke.id)) continue;
        erasedStrokeIds.add(stroke.id);
        eraseStroke(pageNumber, stroke.id);
      }
    },
    [eraseStroke, pageNumber, strokes],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const point = pointFromEvent(event);
      updatePointer(pageNumber, point);

      if (tool === "eraser") {
        event.currentTarget.setPointerCapture(event.pointerId);
        erasedStrokeIdsRef.current = new Set();
        eraseAtPoint(point);
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      draftPointsRef.current = [point];
      setDraftPoints([point]);
    },
    [eraseAtPoint, pageNumber, tool, updatePointer],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const point = pointFromEvent(event);
      updatePointer(pageNumber, point);

      if (tool === "eraser") {
        eraseAtPoint(point);
        return;
      }

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
    [eraseAtPoint, pageNumber, tool, updatePointer],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (tool === "eraser") {
        erasedStrokeIdsRef.current = null;
        return;
      }
      finishStroke();
    },
    [finishStroke, tool],
  );

  return (
    <div className={styles.pdfCollaborationLayout}>
      <div className={styles.pdfCollaborationToolbar}>
        <div className={isPdf ? styles.pdfCollaborationControls : "hidden"}>
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
        {tool !== "eraser" ? (
          <>
            <div className={styles.pdfCollaborationControls} aria-label="Stroke color">
              {PDF_STROKE_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  aria-label={`${color.label} color`}
                  aria-pressed={activeColor === color.value}
                  className={`${styles.pdfColorSwatch} ${
                    activeColor === color.value ? styles.pdfColorSwatchActive : ""
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={`${color.label} color`}
                  onClick={() => {
                    if (tool === "highlighter") setHighlighterColor(color.value);
                    else setPenColor(color.value);
                  }}
                />
              ))}
            </div>
            <div className={styles.pdfCollaborationControls} aria-label="Stroke width">
              {widthOptions.map((width, index) => {
                const WidthIcon = index === 0 ? Minus : index === 1 ? Circle : Plus;
                return (
                  <Button
                    key={width}
                    type="button"
                    variant={activeWidth === width ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={`Stroke width ${index + 1}`}
                    title={`Stroke width ${index + 1}`}
                    onClick={() => {
                      if (tool === "highlighter") setHighlighterWidth(width);
                      else setPenWidth(width);
                    }}
                  >
                    <WidthIcon />
                  </Button>
                );
              })}
            </div>
          </>
        ) : null}
        <div className={styles.pdfCollaborationPresence} title={isConnected ? "공동 열람 연결됨" : "공동 열람 연결 중"}>
          <Users />
          {presence.length === 0 ? (
            <span>나만 보고 있음</span>
          ) : (
            presence.slice(0, 3).map((member) => (
              <span key={member.userId} className={styles.pdfCollaborationMember}>
                {member.displayName}{isPdf ? ` ${member.pageNumber}p` : ""}
              </span>
            ))
          )}
        </div>
      </div>

      <div ref={viewportRef} className={styles.pdfCollaborationViewport}>
        <div className={styles.pdfPageFrame} style={{ width: pageWidth }}>
          {isPdf ? (
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
          ) : hasImageError ? (
            <div className={styles.pdfPreviewState}>이미지를 표시하지 못했습니다.</div>
          ) : (
            <img
              alt={fileName}
              className={styles.pdfPreviewImage}
              draggable={false}
              src={previewUrl}
              onError={() => setHasImageError(true)}
            />
          )}
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
                  color: activeColor,
                  id: "draft",
                  pageNumber,
                  points: draftPoints,
                  tool,
                  width: activeWidth,
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
