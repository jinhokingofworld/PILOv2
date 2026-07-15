"use client";

import {
  ArrowRight,
  Bookmark,
  Bot,
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
  RotateCcw,
  Slash,
  Plus,
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
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  createCanvasClient,
  createMockCanvasBoardDetail,
  resolveCanvasClientMode,
} from "@/features/canvas/api/canvas-client";
import { useAuthSession } from "@/features/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isDevPreviewAccessToken } from "@/features/auth/session-storage";
import {
  PiloCanvasRuntime,
  type CanvasBoardDetail,
} from "@/features/canvas/components/engine/runtime/PiloCanvasRuntime";
import { PiloTldrawSyncRuntime } from "@/features/canvas/components/engine/runtime/PiloTldrawSyncRuntime";
import {
  canvasAgentToolTargetEventName,
  getCanvasAgentToolTargetPopover,
} from "@/features/canvas/agent/canvas-agent-tool-targets";
import type { CanvasRealtimeConfig } from "@/shared/canvas-realtime/canvas-realtime-types";
import {
  type PiloCanvasActions,
  type PiloCanvasColor,
  type PiloCanvasHistoryState,
  type PiloCanvasTool,
  type PiloDrawingPreset,
  type PiloInsertableTool,
} from "@/features/canvas/components/engine/surface/PiloTldrawCanvas";

type CanvasBoardState = {
  board: CanvasBoardDetail | null;
  source: "mock" | "api";
  status: "loading" | "ready" | "fallback";
};

type ToolButtonProps = {
  label: string;
  active?: boolean;
  agentTarget?: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

type CanvasUrlInsertTool = Extract<PiloInsertableTool, "bookmark" | "embed">;

const MOCK_CANVAS_WORKSPACE_ID = "pilo-local-workspace";

const canvasColorOptions: {
  label: string;
  value: PiloCanvasColor;
  className: string;
}[] = [
  { label: "기본", value: "default", className: "is-default" },
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
  agentTarget,
  children,
  disabled,
  onClick,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-canvas-agent-target={agentTarget}
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
  const [activeCanvasColor, setActiveCanvasColor] =
    useState<PiloCanvasColor>("default");
  const [urlInsertTool, setUrlInsertTool] = useState<CanvasUrlInsertTool | null>(
    null,
  );
  const [urlInsertValue, setUrlInsertValue] = useState("");
  const [isCreatingRealtimeCanvas, setIsCreatingRealtimeCanvas] =
    useState(false);
  const [openPopover, setOpenPopover] = useState<
    "color" | "draw" | "line" | "insert" | null
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
  const activeColor =
    canvasColorOptions.find((color) => color.value === activeCanvasColor) ??
    canvasColorOptions[0];

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

  useEffect(() => {
    function handleCanvasAgentToolTarget(event: Event) {
      const detail = (event as CustomEvent<{ toolTarget?: unknown }>).detail;
      const toolTarget = typeof detail?.toolTarget === "string" ? detail.toolTarget : "";
      const nextPopover = getCanvasAgentToolTargetPopover(toolTarget);
      if (nextPopover) setOpenPopover(nextPopover);
    }

    window.addEventListener(canvasAgentToolTargetEventName, handleCanvasAgentToolTarget);
    return () => {
      window.removeEventListener(canvasAgentToolTargetEventName, handleCanvasAgentToolTarget);
    };
  }, []);

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

  const handleOneShotToolCreated = useCallback(() => {
    setActiveCanvasTool("select");
  }, []);

  const selectDrawingPreset = useCallback(
    (preset: PiloDrawingPreset) => {
      setOpenPopover("draw");
      setActiveDrawingPreset(preset);
      setActiveCanvasTool("draw");
      canvasActions?.selectDrawingPreset(preset);
    },
    [canvasActions],
  );

  const selectCanvasColor = useCallback(
    (color: PiloCanvasColor) => {
      setActiveCanvasColor(color);
      setOpenPopover("color");
      canvasActions?.setColor(color);
    },
    [canvasActions],
  );

  const selectShapePreset = useCallback(
    (
      preset: Extract<PiloDrawingPreset, "rectangle" | "circle" | "triangle">,
    ) => {
      setOpenPopover("draw");
      setActiveDrawingPreset(preset);
      setActiveCanvasTool("geo");
      canvasActions?.selectDrawingPreset(preset);
    },
    [canvasActions],
  );

  const createMemo = useCallback(() => {
    closePopover();
    setActiveCanvasTool("note");
    canvasActions?.createNote();
  }, [canvasActions, closePopover]);

  const createCodeBlock = useCallback(() => {
    closePopover();
    setActiveCanvasTool("code");
    canvasActions?.createCodeBlock();
  }, [canvasActions, closePopover]);

  const createInsertableShape = useCallback(
    (tool: CanvasUrlInsertTool) => {
      setUrlInsertValue("");
      setUrlInsertTool(tool);
    },
    [],
  );

  const submitUrlInsert = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!urlInsertTool || !urlInsertValue.trim()) return;

      setOpenPopover("insert");
      setActiveCanvasTool("select");
      canvasActions?.createInsertableShape(urlInsertTool, urlInsertValue.trim());
      setUrlInsertTool(null);
    },
    [canvasActions, urlInsertTool, urlInsertValue],
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

  const openCanvasAiChat = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const buttonBounds = event.currentTarget.getBoundingClientRect();

      closePopover();
      setActiveCanvasTool("select");
      canvasActions?.openCanvasAiChat({
        x: buttonBounds.left + buttonBounds.width / 2,
        y: buttonBounds.top + buttonBounds.height,
      });
    },
    [canvasActions, closePopover],
  );

  const createRealtimeCanvasVersion = useCallback(async () => {
    if (
      !shouldUseCanvasApi ||
      !activeBoard ||
      activeBoard.engineType === "tldraw_sync" ||
      isCreatingRealtimeCanvas
    ) {
      return;
    }

    const confirmed = window.confirm(
      "실시간 동시편집 버전의 새 캔버스를 만들까요?\n기존 캔버스와 shape는 그대로 보존되고, 새 캔버스는 비어 있는 상태로 시작합니다.",
    );

    if (!confirmed) return;

    setIsCreatingRealtimeCanvas(true);

    try {
      const convertedBoard = await canvasClient.convertBoardEngine(
        activeBoard.id,
        {
          copyShapes: false,
          targetEngineType: "tldraw_sync",
        },
        { workspaceId },
      );

      const convertedBoardId =
        typeof convertedBoard === "object" &&
        convertedBoard !== null &&
        "id" in convertedBoard &&
        typeof convertedBoard.id === "string"
          ? convertedBoard.id
          : null;

      if (!convertedBoardId) {
        throw new Error("Canvas engine conversion response is invalid");
      }

      const detail = (await canvasClient.getBoardDetail(convertedBoardId, {
        workspaceId,
      })) as CanvasBoardDetail;

      setBoardState({
        board: detail,
        source: canvasClientMode,
        status: "ready",
      });
      closePopover();
      setActiveCanvasTool("select");
    } catch (error) {
      console.error("Canvas realtime version creation failed", error);
      window.alert(
        "실시간 동시편집 캔버스를 만들지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsCreatingRealtimeCanvas(false);
    }
  }, [
    activeBoard,
    canvasClient,
    canvasClientMode,
    closePopover,
    isCreatingRealtimeCanvas,
    shouldUseCanvasApi,
    workspaceId,
  ]);

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
        <Dialog
          open={urlInsertTool !== null}
          onOpenChange={(open) => {
            if (!open) setUrlInsertTool(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {urlInsertTool === "bookmark" ? "북마크" : "임베드"} URL 추가
              </DialogTitle>
              <DialogDescription>
                캔버스에 추가할 URL을 입력하세요.
              </DialogDescription>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={submitUrlInsert}>
              <Input
                autoFocus
                onChange={(event) => setUrlInsertValue(event.target.value)}
                placeholder={
                  urlInsertTool ? getDefaultInsertUrl(urlInsertTool) : undefined
                }
                type="url"
                value={urlInsertValue}
              />
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setUrlInsertTool(null)}
                  type="button"
                  variant="outline"
                >
                  취소
                </Button>
                <Button disabled={!urlInsertValue.trim()} type="submit">
                  추가
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <nav
          className="canvas-tool-rail"
          aria-label="캔버스 도구"
          onPointerDownCapture={markCanvasUiEvent}
          onPointerUpCapture={markCanvasUiEvent}
        >
          <section className="canvas-tool-section" aria-label="주요 도구">
            <ToolButton
              label="선택"
              agentTarget="toolbar.select"
              active={isCanvasToolActive("select")}
              onClick={() => selectCanvasTool("select")}
            >
              <MousePointer2 />
            </ToolButton>
            <ToolButton
              label="메모"
              agentTarget="toolbar.memo"
              active={isCanvasToolActive("note")}
              onClick={createMemo}
            >
              <StickyNote />
            </ToolButton>
            <ToolButton
              label="프레임"
              agentTarget="toolbar.frame"
              active={isCanvasToolActive("frame")}
              onClick={() => selectCanvasTool("frame")}
            >
              <Square />
            </ToolButton>
            <ToolButton
              label="코드블럭"
              agentTarget="toolbar.code"
              active={isCanvasToolActive("code")}
              onClick={createCodeBlock}
            >
              <Code2 />
            </ToolButton>
            <ToolButton
              label="텍스트"
              agentTarget="toolbar.text"
              active={isCanvasToolActive("text")}
              onClick={() => selectCanvasTool("text")}
            >
              <Type />
            </ToolButton>
            <ToolButton
              label="화살표/선"
              agentTarget="toolbar.line"
              active={openPopover === "line"}
              onClick={() => togglePopover("line")}
            >
              <ArrowRight />
            </ToolButton>
            <ToolButton
              label="그리기"
              agentTarget="toolbar.draw"
              active={openPopover === "draw"}
              onClick={() => {
                togglePopover("draw");
                canvasActions?.selectDrawingPreset(activeDrawingPreset);
              }}
            >
              <Pencil />
            </ToolButton>
            <ToolButton
              label="색상"
              agentTarget="toolbar.color"
              active={openPopover === "color"}
              onClick={() => togglePopover("color")}
            >
              <span className={`canvas-color-swatch ${activeColor.className}`} />
            </ToolButton>
            <ToolButton
              label="더보기"
              agentTarget="toolbar.more"
              active={openPopover === "insert"}
              onClick={() => togglePopover("insert")}
            >
              <Plus />
            </ToolButton>
            <ToolButton label="화면 맞춤" agentTarget="toolbar.fit" onClick={() => canvasActions?.fit()}>
              <Maximize2 />
            </ToolButton>
          </section>

          {openPopover === "draw" ? (
            <section
              className="canvas-tool-popover canvas-draw-popover"
              aria-label="그리기 도구"
            >
              <ToolButton
                label="펜"
                agentTarget="toolbar.draw.pen"
                active={activeDrawingPreset === "pen"}
                onClick={() => selectDrawingPreset("pen")}
              >
                <Pencil />
              </ToolButton>
              <ToolButton
                label="형광펜"
                agentTarget="toolbar.draw.highlight"
                active={activeDrawingPreset === "highlight"}
                onClick={() => selectDrawingPreset("highlight")}
              >
                <Highlighter />
              </ToolButton>
              <ToolButton
                label="지우개"
                agentTarget="toolbar.draw.eraser"
                active={activeDrawingPreset === "eraser"}
                onClick={() => selectDrawingPreset("eraser")}
              >
                <Eraser />
              </ToolButton>
              <ToolButton
                label="사각형"
                agentTarget="toolbar.draw.rectangle"
                active={activeDrawingPreset === "rectangle"}
                onClick={() => selectShapePreset("rectangle")}
              >
                <Square />
              </ToolButton>
              <ToolButton
                label="원"
                agentTarget="toolbar.draw.circle"
                active={activeDrawingPreset === "circle"}
                onClick={() => selectShapePreset("circle")}
              >
                <Circle />
              </ToolButton>
              <ToolButton
                label="삼각형"
                agentTarget="toolbar.draw.triangle"
                active={activeDrawingPreset === "triangle"}
                onClick={() => selectShapePreset("triangle")}
              >
                <Triangle />
              </ToolButton>
            </section>
          ) : null}

          {openPopover === "color" ? (
            <section
              className="canvas-tool-popover canvas-color-popover"
              aria-label="색상"
            >
              {canvasColorOptions.map((color) => (
                <ToolButton
                  key={color.value}
                  label={color.label}
                  active={activeCanvasColor === color.value}
                  onClick={() => selectCanvasColor(color.value)}
                >
                  {color.value === "default" ? (
                    <RotateCcw />
                  ) : (
                    <span className={`canvas-color-swatch ${color.className}`} />
                  )}
                </ToolButton>
              ))}
            </section>
          ) : null}

          {openPopover === "line" ? (
            <section
              className="canvas-tool-popover canvas-draw-popover"
              aria-label="선 도구"
            >
              <ToolButton
                label="화살표"
                agentTarget="toolbar.line.arrow"
                active={activeCanvasTool === "arrow"}
                onClick={() => selectCanvasTool("arrow")}
              >
                <ArrowRight />
              </ToolButton>
              <ToolButton
                label="직선"
                agentTarget="toolbar.line.line"
                active={activeCanvasTool === "line"}
                onClick={() => selectCanvasTool("line")}
              >
                <Slash />
              </ToolButton>
            </section>
          ) : null}

          {openPopover === "insert" ? (
            <section
              className="canvas-tool-popover canvas-draw-popover"
              aria-label="더보기 도구"
            >
              <ToolButton
                label="Canvas AI"
                agentTarget="toolbar.canvas_ai"
                onClick={openCanvasAiChat}
              >
                <Bot />
              </ToolButton>
              <ToolButton label="이미지" agentTarget="toolbar.more.image" onClick={() => openMediaFilePicker("image")}>
                <Image />
              </ToolButton>
              <ToolButton label="비디오" agentTarget="toolbar.more.video" onClick={() => openMediaFilePicker("video")}>
                <Video />
              </ToolButton>
              <ToolButton
                label="북마크"
                agentTarget="toolbar.more.bookmark"
                onClick={() => createInsertableShape("bookmark")}
              >
                <Bookmark />
              </ToolButton>
              <ToolButton
                label="임베드"
                agentTarget="toolbar.more.embed"
                onClick={() => createInsertableShape("embed")}
              >
                <PanelsTopLeft />
              </ToolButton>
              <ToolButton label="그룹" agentTarget="toolbar.more.group" onClick={groupSelectedShapes}>
                <Group />
              </ToolButton>
              <ToolButton
                label="실시간 버전"
                agentTarget="toolbar.more.realtime_canvas"
                disabled={
                  !shouldUseCanvasApi ||
                  activeBoard?.engineType === "tldraw_sync" ||
                  isCreatingRealtimeCanvas
                }
                onClick={createRealtimeCanvasVersion}
              >
                <PanelsTopLeft />
              </ToolButton>
            </section>
          ) : null}

          <section className="canvas-history-section" aria-label="작업 기록">
            <ToolButton
              label="실행 취소"
              agentTarget="toolbar.undo"
              active={canvasHistoryState.canUndo}
              disabled={!canvasHistoryState.canUndo}
              onClick={() => canvasActions?.undo()}
            >
              <Undo2 />
            </ToolButton>
            <ToolButton
              label="다시 실행"
              agentTarget="toolbar.redo"
              active={canvasHistoryState.canRedo}
              disabled={!canvasHistoryState.canRedo}
              onClick={() => canvasActions?.redo()}
            >
              <Redo2 />
            </ToolButton>
          </section>
        </nav>

        {board.engineType === "tldraw_sync" ? (
          <PiloTldrawSyncRuntime
            key={`${board.workspaceId}:${board.id}:tldraw-sync`}
            board={board}
            canvasClient={shouldUseCanvasApi ? canvasClient : null}
            onHistoryStateChange={setCanvasHistoryState}
            onReady={setCanvasActions}
          />
        ) : (
          <PiloCanvasRuntime
            key={`${board.workspaceId}:${board.id}:${shouldUseCanvasApi ? "api" : "local"}`}
            board={board}
            canvasClient={shouldUseCanvasApi ? canvasClient : null}
            onHistoryStateChange={setCanvasHistoryState}
            onOneShotToolCreated={handleOneShotToolCreated}
            onReady={setCanvasActions}
            realtime={canvasRealtimeConfig}
            storageMode={shouldUseCanvasApi ? "api" : "local"}
          />
        )}
      </div>
    </section>
  );
}
