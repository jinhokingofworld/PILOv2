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
  PanelsTopLeft,
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
import { useAuthSession } from "@/features/auth";
import { isDevPreviewAccessToken } from "@/features/auth/session-storage";
import {
  PiloCanvasRuntime,
  type CanvasBoardDetail,
} from "@/features/canvas/components/engine/runtime/PiloCanvasRuntime";
import type { CanvasRealtimeConfig } from "@/features/canvas/realtime/canvas-realtime-types";
import {
  type PiloCanvasActions,
  type PiloCanvasHistoryState,
  type PiloCanvasTool,
  type PiloDrawingPreset,
  type PiloInsertableTool,
} from "@/features/canvas/components/engine/surface/PiloTldrawCanvas";
import {
  piloStickyNoteColors,
  type PiloStickyNoteColor,
} from "@/features/canvas/components/engine/shapes/sticky-note/PiloStickyNoteShapeUtil";
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
  disabled?: boolean;
  onClick: () => void;
};

const MOCK_CANVAS_WORKSPACE_ID = "pilo-local-workspace";

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

const initialCanvasHistoryState: PiloCanvasHistoryState = {
  canUndo: false,
  canRedo: false,
};

function ToolButton({
  label,
  active,
  children,
  disabled,
  onClick,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      className={active ? "is-active" : undefined}
      disabled={disabled}
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

function resolveCanvasWorkspaceId(
  canvasClientMode: CanvasBoardState["source"],
  authWorkspaceId: string | undefined,
) {
  if (authWorkspaceId) {
    return authWorkspaceId;
  }

  return canvasClientMode === "mock" ? MOCK_CANVAS_WORKSPACE_ID : "";
}

export function WorkspaceCanvas({ boardId }: { boardId?: string }) {
  const authSession = useAuthSession();
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
  const [canvasHistoryState, setCanvasHistoryState] =
    useState<PiloCanvasHistoryState>(initialCanvasHistoryState);
  const [activeCanvasTool, setActiveCanvasTool] =
    useState<PiloCanvasTool>("select");
  const [activeDrawingPreset, setActiveDrawingPreset] =
    useState<PiloDrawingPreset>("pen");
  const [activeMemoColor, setActiveMemoColor] =
    useState<PiloStickyNoteColor>("butter");
  const [openPopover, setOpenPopover] = useState<
    "memo" | "draw" | "draw-color" | "line" | "shape" | "insert" | null
  >(null);
  const canvasClientMode = resolveCanvasClientMode();
  const canvasClient = useMemo(
    () =>
      createCanvasClient({
        authToken: authSession?.accessToken ?? null,
        mode: canvasClientMode,
      }),
    [authSession?.accessToken, canvasClientMode],
  );
  const workspaceId = resolveCanvasWorkspaceId(
    canvasClientMode,
    authSession?.activeWorkspaceId,
  );
  const fallbackBoard = useMemo(
    () =>
      createMockCanvasBoardDetail(
        workspaceId || MOCK_CANVAS_WORKSPACE_ID,
      ) as CanvasBoardDetail,
    [workspaceId],
  );
  const activeBoard =
    boardState.board &&
    boardState.board.workspaceId === workspaceId &&
    (!boardId || boardState.board.id === boardId)
      ? boardState.board
      : null;
  const board = activeBoard ?? fallbackBoard;
  const shouldUseCanvasApi =
    boardState.source === "api" &&
    boardState.status === "ready" &&
    activeBoard !== null;
  const canvasRealtimeConfig = useMemo<CanvasRealtimeConfig>(
    () => ({
      enabled: Boolean(
        shouldUseCanvasApi &&
          authSession?.accessToken &&
          !isDevPreviewAccessToken(authSession.accessToken) &&
          authSession.user.id &&
          workspaceId &&
          board.id,
      ),
      workspaceId,
      canvasId: board.id,
      authToken: authSession?.accessToken ?? null,
      currentUser: authSession
        ? {
            userId: authSession.user.id,
            displayName:
              authSession.user.name ?? authSession.user.email ?? "PILO",
            avatarUrl: authSession.user.avatarUrl,
          }
        : null,
    }),
    [
      authSession,
      board.id,
      shouldUseCanvasApi,
      workspaceId,
    ],
  );
  const isCanvasToolActive = (tool: PiloCanvasTool) =>
    openPopover === null && activeCanvasTool === tool;
  const activeDrawingColor =
    drawingColorOptions.find((color) => color.value === activeDrawingPreset) ??
    drawingColorOptions[4];

  useEffect(() => {
    let cancelled = false;

    async function loadCanvasBoard() {
      if (!workspaceId) {
        setBoardState({
          board: null,
          source: canvasClientMode,
          status: "loading",
        });
        return;
      }

      setBoardState({
        board: null,
        source: canvasClientMode,
        status: "loading",
      });

      try {
        const boards = await canvasClient.listBoards(workspaceId);
        let targetBoardId = boardId ?? boards[0]?.id;

        if (!targetBoardId) {
          const createdBoard = await canvasClient.createBoard(workspaceId, {
            title: "PILO Canvas",
          });

          targetBoardId =
            typeof createdBoard === "object" &&
            createdBoard !== null &&
            "id" in createdBoard &&
            typeof createdBoard.id === "string"
              ? createdBoard.id
              : fallbackBoard.id;
        }

        const detail = (await canvasClient.getBoardDetail(targetBoardId, {
          workspaceId,
        })) as CanvasBoardDetail;

        if (cancelled) return;

        setBoardState({
          board: detail,
          source: canvasClientMode,
          status: "ready",
        });
      } catch (error) {
        if (cancelled) return;

        setBoardState({
          board: fallbackBoard,
          source: canvasClientMode,
          status: "fallback",
        });
      }
    }

    void loadCanvasBoard();

    return () => {
      cancelled = true;
    };
  }, [boardId, canvasClient, canvasClientMode, fallbackBoard, workspaceId]);

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
              active={isCanvasToolActive("select")}
              onClick={() => selectCanvasTool("select")}
            >
              <MousePointer2 />
            </ToolButton>
            <ToolButton
              label="프레임"
              active={isCanvasToolActive("frame")}
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
              active={isCanvasToolActive("code")}
              onClick={createCodeBlock}
            >
              <Code2 />
            </ToolButton>
            <ToolButton
              label="텍스트"
              active={isCanvasToolActive("text")}
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
              label="더보기"
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
              aria-label="더보기 도구"
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
                <PanelsTopLeft />
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
            <ToolButton
              label="실행 취소"
              active={canvasHistoryState.canUndo}
              disabled={!canvasHistoryState.canUndo}
              onClick={() => canvasActions?.undo()}
            >
              <Undo2 />
            </ToolButton>
            <ToolButton
              label="다시 실행"
              active={canvasHistoryState.canRedo}
              disabled={!canvasHistoryState.canRedo}
              onClick={() => canvasActions?.redo()}
            >
              <Redo2 />
            </ToolButton>
          </section>
        </nav>

        <PiloCanvasRuntime
          key={`${board.workspaceId}:${board.id}:${shouldUseCanvasApi ? "api" : "local"}`}
          board={board}
          canvasClient={shouldUseCanvasApi ? canvasClient : null}
          onHistoryStateChange={setCanvasHistoryState}
          onReady={setCanvasActions}
          realtime={canvasRealtimeConfig}
          storageMode={shouldUseCanvasApi ? "api" : "local"}
        />
      </div>
    </section>
  );
}
