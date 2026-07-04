"use client";

import {
  ArrowRight,
  Bookmark,
  Circle,
  Code2,
  Eraser,
  Group,
  Highlighter,
  Image,
  Maximize2,
  MousePointer2,
  Pencil,
  Redo2,
  Slash,
  Sparkles,
  Square,
  StickyNote,
  Triangle,
  Type,
  Undo2,
  Video,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  createCanvasClient,
  createMockCanvasBoardDetail,
  resolveCanvasClientMode,
} from "@/features/canvas/api/canvas-client";
import {
  PiloCanvasRuntime,
  type CanvasBoardDetail,
} from "@/features/canvas/components/engine/PiloCanvasRuntime";
import {
  type PiloCanvasActions,
  type PiloCanvasTool,
  type PiloDrawingPreset,
  type PiloInsertableTool,
} from "@/features/canvas/components/engine/PiloTldrawCanvas";
import {
  piloStickyNoteColors,
  type PiloStickyNoteColor,
} from "@/features/canvas/components/engine/PiloStickyNoteShapeUtil";
import { cn } from "@/lib/utils";

type CanvasBoardState = {
  board: CanvasBoardDetail | null;
  source: "mock" | "api";
  status: "loading" | "ready" | "fallback";
};

type ToolButtonProps = {
  label: string;
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
};

const PILO_LOCAL_WORKSPACE_ID = "pilo-local-workspace";

const drawingColorOptions: {
  label: string;
  value: PiloDrawingPreset;
  className: string;
}[] = [
  { label: "검정", value: "black", className: "is-black" },
  { label: "빨강", value: "red", className: "is-red" },
  { label: "노랑", value: "yellow", className: "is-yellow" },
  { label: "초록", value: "green", className: "is-green" },
  { label: "파랑", value: "blue", className: "is-blue" },
  { label: "보라", value: "violet", className: "is-violet" },
];

function ToolButton({ label, active, children, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      className={active ? "is-active" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function getDefaultInsertUrl(tool: PiloInsertableTool) {
  return tool === "bookmark"
    ? "https://github.com/Developer-EJ/PILO"
    : "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
}

export function WorkspaceCanvas({ boardId }: { boardId?: string }) {
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [boardState, setBoardState] = useState<CanvasBoardState>({
    board: null,
    source: "mock",
    status: "loading",
  });
  const [canvasActions, setCanvasActions] = useState<PiloCanvasActions | null>(
    null,
  );
  const [activeCanvasTool, setActiveCanvasTool] =
    useState<PiloCanvasTool>("select");
  const [activeDrawingPreset, setActiveDrawingPreset] =
    useState<PiloDrawingPreset>("pen");
  const [activeMemoColor, setActiveMemoColor] =
    useState<PiloStickyNoteColor>("butter");
  const [openPopover, setOpenPopover] = useState<
    "memo" | "draw" | "draw-color" | "line" | "shape" | "insert" | null
  >(null);
  const workspaceId = PILO_LOCAL_WORKSPACE_ID;
  const fallbackBoard = useMemo(
    () => createMockCanvasBoardDetail(workspaceId) as CanvasBoardDetail,
    [workspaceId],
  );
  const board = boardState.board ?? fallbackBoard;
  const activeDrawingColor =
    drawingColorOptions.find((color) => color.value === activeDrawingPreset) ??
    drawingColorOptions[4];

  useEffect(() => {
    let cancelled = false;
    const canvasClient = createCanvasClient({ mode: "mock" });

    async function loadCanvasBoard() {
      setBoardState({
        board: null,
        source: "mock",
        status: "loading",
      });

      try {
        const boards = await canvasClient.listBoards(workspaceId);
        const targetBoardId = boardId ?? boards[0]?.id ?? fallbackBoard.id;
        const detail = (await canvasClient.getBoardDetail(targetBoardId, {
          workspaceId,
        })) as CanvasBoardDetail;

        if (cancelled) return;

        setBoardState({
          board: detail,
          source: resolveCanvasClientMode("mock"),
          status: "ready",
        });
      } catch (error) {
        if (cancelled) return;

        setBoardState({
          board: fallbackBoard,
          source: "mock",
          status: "fallback",
        });
      }
    }

    void loadCanvasBoard();

    return () => {
      cancelled = true;
    };
  }, [boardId, fallbackBoard, workspaceId]);

  const closePopover = useCallback(() => {
    setOpenPopover(null);
  }, []);

  const selectCanvasTool = useCallback(
    (tool: PiloCanvasTool) => {
      closePopover();
      setActiveCanvasTool(tool);
      canvasActions?.selectTool(tool);
    },
    [canvasActions, closePopover],
  );

  const selectDrawingPreset = useCallback(
    (preset: PiloDrawingPreset) => {
      setOpenPopover("draw");
      setActiveDrawingPreset(preset);
      setActiveCanvasTool("draw");
      canvasActions?.selectDrawingPreset(preset);
    },
    [canvasActions],
  );

  const selectShapePreset = useCallback(
    (
      preset: Extract<PiloDrawingPreset, "rectangle" | "circle" | "triangle">,
    ) => {
      setOpenPopover("shape");
      setActiveDrawingPreset(preset);
      setActiveCanvasTool("geo");
      canvasActions?.selectDrawingPreset(preset);
    },
    [canvasActions],
  );

  const createMemo = useCallback(
    (color = activeMemoColor) => {
      setActiveMemoColor(color);
      setOpenPopover("memo");
      canvasActions?.createStickyNote(color);
    },
    [activeMemoColor, canvasActions],
  );

  const createMemoStack = useCallback(() => {
    setOpenPopover("memo");
    canvasActions?.createStickyStack(activeMemoColor);
  }, [activeMemoColor, canvasActions]);

  const createCodeBlock = useCallback(() => {
    closePopover();
    setActiveCanvasTool("code");
    canvasActions?.createCodeBlock();
  }, [canvasActions, closePopover]);

  const createInsertableShape = useCallback(
    (tool: PiloInsertableTool) => {
      const url = window.prompt("URL을 입력하세요", getDefaultInsertUrl(tool));

      if (!url?.trim()) return;

      setOpenPopover("insert");
      setActiveCanvasTool("select");
      canvasActions?.createInsertableShape(tool, url.trim());
    },
    [canvasActions],
  );

  const openMediaFilePicker = useCallback(
    (tool: Extract<PiloInsertableTool, "image" | "video">) => {
      if (tool === "image") {
        imageFileInputRef.current?.click();
        return;
      }

      videoFileInputRef.current?.click();
    },
    [],
  );

  const createMediaFileShape = useCallback(
    (
      tool: Extract<PiloInsertableTool, "image" | "video">,
      file: File | undefined,
    ) => {
      if (!file) return;

      const reader = new FileReader();

      reader.addEventListener("load", () => {
        const dataUrl = reader.result;

        if (typeof dataUrl !== "string") return;

        setOpenPopover("insert");
        setActiveCanvasTool("select");
        canvasActions?.createInsertableShape(tool, dataUrl);
      });

      reader.addEventListener("error", () => {
        window.alert("선택한 파일을 불러오지 못했습니다.");
      });

      reader.readAsDataURL(file);
    },
    [canvasActions],
  );

  const groupSelectedShapes = useCallback(() => {
    setOpenPopover("insert");
    setActiveCanvasTool("select");
    canvasActions?.groupSelection();
  }, [canvasActions]);

  const markCanvasUiEvent = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      canvasActions?.markUiEventAsHandled(event);
      event.stopPropagation();
    },
    [canvasActions],
  );

  function togglePopover(nextPopover: typeof openPopover) {
    setOpenPopover((currentPopover) =>
      currentPopover === nextPopover ? null : nextPopover,
    );
  }

  return (
    <section className="canvas-feature pilo-canvas-screen">
      <div className="pilo-canvas-frame">
        <input
          ref={imageFileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            createMediaFileShape("image", event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <input
          ref={videoFileInputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(event) => {
            createMediaFileShape("video", event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        <nav
          className="canvas-tool-rail"
          aria-label="캔버스 도구"
          onPointerDownCapture={markCanvasUiEvent}
          onPointerUpCapture={markCanvasUiEvent}
        >
          <section className="canvas-tool-section" aria-label="주요 도구">
            <ToolButton
              label="선택"
              active={activeCanvasTool === "select"}
              onClick={() => selectCanvasTool("select")}
            >
              <MousePointer2 />
            </ToolButton>
            <ToolButton
              label="프레임"
              active={activeCanvasTool === "frame"}
              onClick={() => selectCanvasTool("frame")}
            >
              <Square />
            </ToolButton>
            <ToolButton
              label="메모"
              active={openPopover === "memo"}
              onClick={() => togglePopover("memo")}
            >
              <StickyNote />
            </ToolButton>
            <ToolButton
              label="코드블럭"
              active={activeCanvasTool === "code"}
              onClick={createCodeBlock}
            >
              <Code2 />
            </ToolButton>
            <ToolButton
              label="텍스트"
              active={activeCanvasTool === "text"}
              onClick={() => selectCanvasTool("text")}
            >
              <Type />
            </ToolButton>
            <ToolButton
              label="화살표/선"
              active={openPopover === "line"}
              onClick={() => togglePopover("line")}
            >
              <ArrowRight />
            </ToolButton>
            <ToolButton
              label="그리기"
              active={openPopover === "draw" || openPopover === "draw-color"}
              onClick={() => {
                togglePopover("draw");
                canvasActions?.selectDrawingPreset(activeDrawingPreset);
              }}
            >
              <Pencil />
            </ToolButton>
            <ToolButton
              label="도형"
              active={openPopover === "shape"}
              onClick={() => togglePopover("shape")}
            >
              <Triangle />
            </ToolButton>
            <ToolButton
              label="삽입"
              active={openPopover === "insert"}
              onClick={() => togglePopover("insert")}
            >
              <Sparkles />
            </ToolButton>
            <ToolButton label="화면 맞춤" onClick={() => canvasActions?.fit()}>
              <Maximize2 />
            </ToolButton>
          </section>

          {openPopover === "draw" || openPopover === "draw-color" ? (
            <section
              className="canvas-tool-popover canvas-draw-popover"
              aria-label="그리기 도구"
            >
              <ToolButton
                label="펜"
                active={activeDrawingPreset === "pen"}
                onClick={() => selectDrawingPreset("pen")}
              >
                <Pencil />
              </ToolButton>
              <ToolButton
                label="형광펜"
                active={activeDrawingPreset === "highlight"}
                onClick={() => selectDrawingPreset("highlight")}
              >
                <Highlighter />
              </ToolButton>
              <ToolButton
                label="지우개"
                active={activeDrawingPreset === "eraser"}
                onClick={() => selectDrawingPreset("eraser")}
              >
                <Eraser />
              </ToolButton>
              <div className="canvas-draw-color-picker">
                <ToolButton
                  label="색상"
                  active={openPopover === "draw-color"}
                  onClick={() => togglePopover("draw-color")}
                >
                  <span
                    className={`canvas-color-swatch ${activeDrawingColor.className}`}
                  />
                </ToolButton>
                {openPopover === "draw-color" ? (
                  <div
                    className="canvas-draw-color-menu"
                    aria-label="그리기 색상"
                  >
                    {drawingColorOptions.map((color) => (
                      <ToolButton
                        key={color.value}
                        label={color.label}
                        active={activeDrawingPreset === color.value}
                        onClick={() => selectDrawingPreset(color.value)}
                      >
                        <span
                          className={`canvas-color-swatch ${color.className}`}
                        />
                      </ToolButton>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {openPopover === "line" ? (
            <section
              className="canvas-tool-popover canvas-draw-popover"
              aria-label="선 도구"
            >
              <ToolButton
                label="화살표"
                active={activeCanvasTool === "arrow"}
                onClick={() => selectCanvasTool("arrow")}
              >
                <ArrowRight />
              </ToolButton>
              <ToolButton
                label="직선"
                active={activeCanvasTool === "line"}
                onClick={() => selectCanvasTool("line")}
              >
                <Slash />
              </ToolButton>
            </section>
          ) : null}

          {openPopover === "shape" ? (
            <section
              className="canvas-tool-popover canvas-draw-popover"
              aria-label="도형 도구"
            >
              <ToolButton
                label="사각형"
                active={activeDrawingPreset === "rectangle"}
                onClick={() => selectShapePreset("rectangle")}
              >
                <Square />
              </ToolButton>
              <ToolButton
                label="원"
                active={activeDrawingPreset === "circle"}
                onClick={() => selectShapePreset("circle")}
              >
                <Circle />
              </ToolButton>
              <ToolButton
                label="삼각형"
                active={activeDrawingPreset === "triangle"}
                onClick={() => selectShapePreset("triangle")}
              >
                <Triangle />
              </ToolButton>
            </section>
          ) : null}

          {openPopover === "insert" ? (
            <section
              className="canvas-tool-popover canvas-draw-popover"
              aria-label="삽입 도구"
            >
              <ToolButton label="이미지" onClick={() => openMediaFilePicker("image")}>
                <Image />
              </ToolButton>
              <ToolButton label="비디오" onClick={() => openMediaFilePicker("video")}>
                <Video />
              </ToolButton>
              <ToolButton
                label="북마크"
                onClick={() => createInsertableShape("bookmark")}
              >
                <Bookmark />
              </ToolButton>
              <ToolButton
                label="임베드"
                onClick={() => createInsertableShape("embed")}
              >
                <Code2 />
              </ToolButton>
              <ToolButton label="그룹" onClick={groupSelectedShapes}>
                <Group />
              </ToolButton>
            </section>
          ) : null}

          {openPopover === "memo" ? (
            <section
              className="canvas-tool-popover canvas-memo-popover"
              aria-label="메모 색상"
            >
              <div className="canvas-memo-color-grid">
                {piloStickyNoteColors.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    aria-label={`${color.label} 메모`}
                    data-tooltip={color.label}
                    className={cn(
                      activeMemoColor === color.value && "is-active",
                    )}
                    style={{
                      background: color.fill,
                      borderColor: color.border,
                    }}
                    onClick={() => createMemo(color.value)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="canvas-memo-command"
                aria-label="메모 생성"
                data-tooltip="생성"
                onClick={() => createMemo()}
              >
                <Sparkles />
                <span>생성</span>
              </button>
              <button
                type="button"
                className="canvas-memo-command"
                aria-label="메모 스택 생성"
                data-tooltip="스택"
                onClick={createMemoStack}
              >
                <StickyNote />
                <span>스택</span>
              </button>
            </section>
          ) : null}

          <section className="canvas-history-section" aria-label="작업 기록">
            <ToolButton label="실행 취소" onClick={() => canvasActions?.undo()}>
              <Undo2 />
            </ToolButton>
            <ToolButton label="다시 실행" onClick={() => canvasActions?.redo()}>
              <Redo2 />
            </ToolButton>
          </section>
        </nav>

        <PiloCanvasRuntime board={board} onReady={setCanvasActions} />
      </div>
    </section>
  );
}
