"use client";

import {
  AlignCenter,
  AlignCenterVertical,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Bot,
  BringToFront,
  CheckSquare,
  Circle,
  Cloud,
  Code2,
  Columns3,
  Copy,
  Diamond,
  Eraser,
  Files,
  Group,
  Hand,
  Heart,
  Highlighter,
  Hexagon,
  Image,
  Maximize2,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Redo2,
  RotateCcw,
  Rows3,
  SendToBack,
  Slash,
  Plus,
  Square,
  Star,
  StickyNote,
  Triangle,
  TvMinimalPlay,
  Type,
  Ungroup,
  Undo2,
  Video,
  XSquare,
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
  ClassicCanvasRuntime,
  type CanvasBoardDetail,
} from "@/features/canvas/engine/runtime/ClassicCanvasRuntime";
import { TldrawSyncCanvasRuntime } from "@/features/canvas/engine/runtime/TldrawSyncCanvasRuntime";
import {
  canvasAgentToolTargetEventName,
  getCanvasAgentToolTargetPopover,
} from "@/features/canvas/agent/canvas-agent-tool-targets";
import type { CanvasRealtimeConfig } from "@/shared/canvas-realtime/canvas-realtime-types";
import {
  type PiloCanvasActions,
  type PiloCanvasColor,
  type PiloCanvasDash,
  type PiloCanvasExportFormat,
  type PiloCanvasExportScope,
  type PiloCanvasFill,
  type PiloCanvasHistoryState,
  type PiloCanvasSelectionAction,
  type PiloCanvasSize,
  type PiloCanvasStyleState,
  type PiloCanvasTool,
  type PiloCanvasUserPreference,
  type PiloCanvasUserPreferenceState,
  type PiloDrawingPreset,
} from "@/features/canvas/engine/editor/canvas-editor-contracts";
import type { PiloInsertableTool } from "@/features/canvas/engine/shapes/pilo-canvas-shape-factory";
import { CanvasDriveFilePicker } from "@/features/canvas/integrations/drive/CanvasDriveFilePicker";
import {
  shouldReuseLoadedCanvasBoard,
  type LoadedCanvasBoardIdentity,
} from "./canvas-board-load-policy";
import {
  CanvasPopoverMenuButton as PopoverMenuButton,
  CanvasToolButton as ToolButton,
} from "./toolbar/CanvasToolButtons";

type CanvasBoardState = {
  board: CanvasBoardDetail | null;
  source: "mock" | "api";
  status: "loading" | "ready" | "fallback";
};

type CanvasUrlInsertTool = Extract<PiloInsertableTool, "bookmark" | "embed">;
type CanvasGeoDrawingPreset = Exclude<
  PiloDrawingPreset,
  "pen" | "highlight" | "eraser"
>;

const MOCK_CANVAS_WORKSPACE_ID = "pilo-local-workspace";
const RETURN_TO_CLASSIC_CANVAS_SHORTCUT = "Ctrl+Alt+C";

const canvasColorOptions: {
  label: string;
  value: PiloCanvasColor;
  className: string;
}[] = [
  { label: "기본", value: "default", className: "is-default" },
  { label: "검정", value: "black", className: "is-black" },
  { label: "회색", value: "grey", className: "is-grey" },
  { label: "흰색", value: "white", className: "is-white" },
  { label: "연보라", value: "light-violet", className: "is-light-violet" },
  { label: "보라", value: "violet", className: "is-violet" },
  { label: "파랑", value: "blue", className: "is-blue" },
  { label: "연파랑", value: "light-blue", className: "is-light-blue" },
  { label: "초록", value: "green", className: "is-green" },
  { label: "연초록", value: "light-green", className: "is-light-green" },
  { label: "노랑", value: "yellow", className: "is-yellow" },
  { label: "주황", value: "orange", className: "is-orange" },
  { label: "연빨강", value: "light-red", className: "is-light-red" },
  { label: "빨강", value: "red", className: "is-red" },
];

const initialCanvasHistoryState: PiloCanvasHistoryState = {
  canUndo: false,
  canRedo: false,
};

const canvasGeoShapeOptions: {
  icon: ReactNode;
  label: string;
  value: CanvasGeoDrawingPreset;
}[] = [
  { icon: <Square />, label: "사각형", value: "rectangle" },
  { icon: <Circle />, label: "원", value: "circle" },
  { icon: <Triangle />, label: "삼각형", value: "triangle" },
  { icon: <Diamond />, label: "다이아몬드", value: "diamond" },
  { icon: <Hexagon />, label: "육각형", value: "hexagon" },
  { icon: <span className="canvas-shape-glyph">⬭</span>, label: "타원", value: "ellipse" },
  { icon: <span className="canvas-shape-glyph">▱</span>, label: "마름모", value: "rhombus" },
  { icon: <span className="canvas-shape-glyph">▱</span>, label: "반대 마름모", value: "rhombus-2" },
  { icon: <Star />, label: "별", value: "star" },
  { icon: <Cloud />, label: "클라우드", value: "cloud" },
  { icon: <Heart />, label: "하트", value: "heart" },
  { icon: <XSquare />, label: "X 박스", value: "x-box" },
  { icon: <CheckSquare />, label: "체크박스", value: "check-box" },
  { icon: <ArrowLeft />, label: "왼쪽 화살표", value: "arrow-left" },
  { icon: <ArrowUp />, label: "위쪽 화살표", value: "arrow-up" },
  { icon: <ArrowDown />, label: "아래쪽 화살표", value: "arrow-down" },
  { icon: <ArrowRight />, label: "오른쪽 화살표", value: "arrow-right" },
];

const canvasFillOptions: { label: string; value: PiloCanvasFill }[] = [
  { label: "없음", value: "none" },
  { label: "무색", value: "semi" },
  { label: "단색", value: "solid" },
  { label: "채우기", value: "fill" },
];

const canvasDashOptions: { label: string; value: PiloCanvasDash }[] = [
  { label: "그린 선", value: "draw" },
  { label: "파선", value: "dashed" },
  { label: "점선", value: "dotted" },
  { label: "실선", value: "solid" },
];

const canvasSizeOptions: { label: string; value: PiloCanvasSize }[] = [
  { label: "소", value: "s" },
  { label: "중", value: "m" },
  { label: "대", value: "l" },
  { label: "특대", value: "xl" },
];

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
  const loadedBoardIdentityRef = useRef<LoadedCanvasBoardIdentity | null>(null);
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
  const [activeCanvasFill, setActiveCanvasFill] =
    useState<PiloCanvasFill | null>("none");
  const [activeCanvasDash, setActiveCanvasDash] =
    useState<PiloCanvasDash | null>("draw");
  const [activeCanvasSize, setActiveCanvasSize] =
    useState<PiloCanvasSize | null>("m");
  const [canvasOpacityPercent, setCanvasOpacityPercent] = useState(100);
  const [isCanvasOpacityMixed, setIsCanvasOpacityMixed] = useState(false);
  const [canvasExportScope, setCanvasExportScope] =
    useState<PiloCanvasExportScope>("selection");
  const [isCanvasExportBackgroundEnabled, setIsCanvasExportBackgroundEnabled] =
    useState(true);
  const [canvasUserPreferences, setCanvasUserPreferences] =
    useState<PiloCanvasUserPreferenceState>({
      "paste-at-cursor": false,
      "reduce-motion": false,
      "wrap-text": false,
    });
  const [urlInsertTool, setUrlInsertTool] = useState<CanvasUrlInsertTool | null>(
    null,
  );
  const [urlInsertValue, setUrlInsertValue] = useState("");
  const [isDriveFilePickerOpen, setIsDriveFilePickerOpen] = useState(false);
  const [isReturningToClassicCanvas, setIsReturningToClassicCanvas] =
    useState(false);
  const [openPopover, setOpenPopover] = useState<
    | "actions"
    | "color"
    | "draw"
    | "insert"
    | "line"
    | null
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
    if (!canvasActions) return;

    setCanvasUserPreferences(canvasActions.getUserPreferences());
  }, [canvasActions]);

  useEffect(() => {
    let cancelled = false;

    async function loadCanvasBoard() {
      if (
        shouldReuseLoadedCanvasBoard({
          client: canvasClient,
          loadedBoard: loadedBoardIdentityRef.current,
          requestedBoardId: boardId,
          workspaceId,
        })
      ) {
        return;
      }

      loadedBoardIdentityRef.current = null;

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

        loadedBoardIdentityRef.current = {
          boardId: detail.id,
          client: canvasClient,
          workspaceId: detail.workspaceId,
        };
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
    (preset: CanvasGeoDrawingPreset) => {
      setOpenPopover("draw");
      setActiveDrawingPreset(preset);
      setActiveCanvasTool("geo");
      canvasActions?.selectDrawingPreset(preset);
    },
    [canvasActions],
  );

  const selectCanvasFill = useCallback(
    (fill: PiloCanvasFill) => {
      setActiveCanvasFill(fill);
      canvasActions?.setFill(fill);
    },
    [canvasActions],
  );

  const selectCanvasDash = useCallback(
    (dash: PiloCanvasDash) => {
      setActiveCanvasDash(dash);
      canvasActions?.setDash(dash);
    },
    [canvasActions],
  );

  const selectCanvasSize = useCallback(
    (size: PiloCanvasSize) => {
      setActiveCanvasSize(size);
      canvasActions?.setSize(size);
    },
    [canvasActions],
  );

  const commitCanvasOpacity = useCallback(() => {
    if (isCanvasOpacityMixed) return;

    canvasActions?.setOpacity(canvasOpacityPercent / 100);
  }, [canvasActions, canvasOpacityPercent, isCanvasOpacityMixed]);

  const toggleCanvasAppearancePopover = useCallback(() => {
    const styleState: PiloCanvasStyleState | undefined =
      canvasActions?.getStyleState();

    if (styleState) {
      setActiveCanvasFill(styleState.fill);
      setActiveCanvasDash(styleState.dash);
      setActiveCanvasSize(styleState.size);
      setIsCanvasOpacityMixed(styleState.opacity === null);
    }
    if (styleState?.opacity !== null && styleState?.opacity !== undefined) {
      setCanvasOpacityPercent(Math.round(styleState.opacity * 100));
    }

    togglePopover("color");
  }, [canvasActions]);

  const performCanvasSelectionAction = useCallback(
    (action: PiloCanvasSelectionAction) => {
      setActiveCanvasTool("select");
      canvasActions?.performSelectionAction(action);
    },
    [canvasActions],
  );

  const exportCanvas = useCallback(
    async (format: PiloCanvasExportFormat) => {
      try {
        const exported = await canvasActions?.exportCanvas(
          format,
          canvasExportScope,
          isCanvasExportBackgroundEnabled,
        );
        if (exported === false && canvasExportScope === "selection") {
          window.alert("내보낼 shape를 먼저 선택해 주세요.");
        }
      } catch (error) {
        console.error("Canvas export failed", error);
        window.alert("Canvas를 내보내지 못했습니다. 다시 시도해 주세요.");
      }
    },
    [
      canvasActions,
      canvasExportScope,
      isCanvasExportBackgroundEnabled,
    ],
  );

  const setCanvasUserPreference = useCallback(
    (preference: PiloCanvasUserPreference, enabled: boolean) => {
      if (!canvasActions) return;

      setCanvasUserPreferences(
        canvasActions.setUserPreference(preference, enabled),
      );
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

  const createDriveFileShape = useCallback(
    (file: Parameters<PiloCanvasActions["createDriveFileShape"]>[0]) => {
      setOpenPopover("insert");
      setActiveCanvasTool("select");
      canvasActions?.createDriveFileShape(file);
    },
    [canvasActions],
  );

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

  const returnToSourceClassicCanvas = useCallback(async () => {
    if (
      !shouldUseCanvasApi ||
      !activeBoard ||
      activeBoard.engineType !== "tldraw_sync" ||
      !activeBoard.sourceCanvasId ||
      isReturningToClassicCanvas
    ) {
      return;
    }

    setIsReturningToClassicCanvas(true);

    try {
      const detail = (await canvasClient.getBoardDetail(
        activeBoard.sourceCanvasId,
        {
          workspaceId,
        },
      )) as CanvasBoardDetail;

      setBoardState({
        board: detail,
        source: canvasClientMode,
        status: "ready",
      });
      closePopover();
      setActiveCanvasTool("select");
    } catch (error) {
      console.error("Canvas classic source open failed", error);
      window.alert(
        "원본 classic Canvas를 열지 못했습니다. Canvas 목록에서 직접 다시 선택해 주세요.",
      );
    } finally {
      setIsReturningToClassicCanvas(false);
    }
  }, [
    activeBoard,
    canvasClient,
    canvasClientMode,
    closePopover,
    isReturningToClassicCanvas,
    shouldUseCanvasApi,
    workspaceId,
  ]);

  useEffect(() => {
    function handleReturnToClassicCanvasShortcut(event: KeyboardEvent) {
      if (
        !event.ctrlKey ||
        !event.altKey ||
        event.key.toLowerCase() !== "c"
      ) {
        return;
      }

      if (
        activeBoard?.engineType !== "tldraw_sync" ||
        !activeBoard.sourceCanvasId
      ) {
        return;
      }

      event.preventDefault();
      void returnToSourceClassicCanvas();
    }

    window.addEventListener("keydown", handleReturnToClassicCanvasShortcut);
    return () => {
      window.removeEventListener(
        "keydown",
        handleReturnToClassicCanvasShortcut,
      );
    };
  }, [
    activeBoard?.engineType,
    activeBoard?.sourceCanvasId,
    returnToSourceClassicCanvas,
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
        <CanvasDriveFilePicker
          accessToken={authSession?.accessToken.trim() ?? ""}
          onOpenChange={setIsDriveFilePickerOpen}
          onSelect={createDriveFileShape}
          open={isDriveFilePickerOpen}
          workspaceId={workspaceId}
        />
        <div
          className="canvas-tool-rail canvas-top-left-controls"
          onPointerDownCapture={markCanvasUiEvent}
          onPointerUpCapture={markCanvasUiEvent}
        >
          <ToolButton
            label="액션"
            agentTarget="toolbar.actions"
            active={openPopover === "actions"}
            onClick={() => togglePopover("actions")}
          >
            <MoreHorizontal />
          </ToolButton>
          <ToolButton
            label="색상·스타일"
            agentTarget="toolbar.color"
            active={openPopover === "color"}
            onClick={toggleCanvasAppearancePopover}
          >
            <span className={`canvas-color-swatch ${activeColor.className}`} />
          </ToolButton>

          {openPopover === "actions" ? (
            <section
              className="canvas-tool-popover canvas-menu-popover"
              aria-label="Canvas 액션"
            >
              <PopoverMenuButton
                icon={<MousePointer2 />}
                onClick={() => performCanvasSelectionAction("select-all")}
              >
                전체 선택
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<Copy />}
                onClick={() => performCanvasSelectionAction("duplicate")}
              >
                복제
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<Group />}
                onClick={() => performCanvasSelectionAction("group")}
              >
                그룹
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<Ungroup />}
                onClick={() => performCanvasSelectionAction("ungroup")}
              >
                그룹 해제
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<BringToFront />}
                onClick={() => performCanvasSelectionAction("bring-to-front")}
              >
                맨 앞으로
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<SendToBack />}
                onClick={() => performCanvasSelectionAction("send-to-back")}
              >
                맨 뒤로
              </PopoverMenuButton>
              <div className="canvas-menu-divider" />
              <PopoverMenuButton
                icon={<AlignLeft />}
                onClick={() => performCanvasSelectionAction("align-left")}
              >
                왼쪽 정렬
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<AlignCenter />}
                onClick={() => performCanvasSelectionAction("align-center")}
              >
                가운데 정렬
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<AlignRight />}
                onClick={() => performCanvasSelectionAction("align-right")}
              >
                오른쪽 정렬
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<AlignStartVertical />}
                onClick={() => performCanvasSelectionAction("align-top")}
              >
                위쪽 정렬
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<AlignCenterVertical />}
                onClick={() => performCanvasSelectionAction("align-middle")}
              >
                세로 가운데 정렬
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<AlignEndVertical />}
                onClick={() => performCanvasSelectionAction("align-bottom")}
              >
                아래쪽 정렬
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<Columns3 />}
                onClick={() =>
                  performCanvasSelectionAction("distribute-horizontal")
                }
              >
                가로 간격 맞춤
              </PopoverMenuButton>
              <PopoverMenuButton
                icon={<Rows3 />}
                onClick={() =>
                  performCanvasSelectionAction("distribute-vertical")
                }
              >
                세로 간격 맞춤
              </PopoverMenuButton>
              <div className="canvas-menu-divider" />
              <div className="canvas-popover-group">
                <strong>내보내기</strong>
                <div className="canvas-segmented-options canvas-export-scope-options">
                  <button
                    type="button"
                    className={
                      canvasExportScope === "selection"
                        ? "is-active"
                        : undefined
                    }
                    onClick={() => setCanvasExportScope("selection")}
                  >
                    선택 영역
                  </button>
                  <button
                    type="button"
                    className={
                      canvasExportScope === "canvas" ? "is-active" : undefined
                    }
                    onClick={() => setCanvasExportScope("canvas")}
                  >
                    전체 Canvas
                  </button>
                </div>
                <label className="canvas-setting-toggle">
                  <input
                    type="checkbox"
                    checked={isCanvasExportBackgroundEnabled}
                    onChange={(event) =>
                      setIsCanvasExportBackgroundEnabled(event.target.checked)
                    }
                  />
                  <span>배경 포함</span>
                </label>
                <div className="canvas-export-actions">
                  <button type="button" onClick={() => void exportCanvas("png")}>
                    PNG
                  </button>
                  <button type="button" onClick={() => void exportCanvas("svg")}>
                    SVG
                  </button>
                </div>
              </div>
              <div className="canvas-menu-divider" />
              <div className="canvas-popover-group">
                <strong>사용자 설정</strong>
                <label className="canvas-setting-toggle">
                  <input
                    type="checkbox"
                    checked={canvasUserPreferences["paste-at-cursor"]}
                    onChange={(event) =>
                      setCanvasUserPreference(
                        "paste-at-cursor",
                        event.target.checked,
                      )
                    }
                  />
                  <span>커서 위치에 복사한 내용 붙여넣기</span>
                </label>
                <label className="canvas-setting-toggle">
                  <input
                    type="checkbox"
                    checked={canvasUserPreferences["wrap-text"]}
                    onChange={(event) =>
                      setCanvasUserPreference("wrap-text", event.target.checked)
                    }
                  />
                  <span>완전히 감싼 도형만 선택</span>
                </label>
                <label className="canvas-setting-toggle">
                  <input
                    type="checkbox"
                    checked={canvasUserPreferences["reduce-motion"]}
                    onChange={(event) =>
                      setCanvasUserPreference(
                        "reduce-motion",
                        event.target.checked,
                      )
                    }
                  />
                  <span>모션 줄이기</span>
                </label>
                <p className="canvas-settings-note">
                  이 설정은 현재 사용자의 브라우저에만 적용되며 다른 참여자의
                  roomState에는 전송되지 않습니다.
                </p>
              </div>
            </section>
          ) : null}

          {openPopover === "color" ? (
            <section
              className="canvas-tool-popover canvas-appearance-popover"
              aria-label="색상과 도형 스타일"
            >
              <div className="canvas-popover-group">
                <strong>색상</strong>
                <div className="canvas-color-option-grid">
                  {canvasColorOptions.map((color) => (
                    <ToolButton
                      key={color.value}
                      label={color.label}
                      nativeTooltip
                      active={activeCanvasColor === color.value}
                      onClick={() => selectCanvasColor(color.value)}
                    >
                      {color.value === "default" ? (
                        <RotateCcw />
                      ) : (
                        <span
                          className={`canvas-color-swatch ${color.className}`}
                        />
                      )}
                    </ToolButton>
                  ))}
                </div>
              </div>
              <div className="canvas-popover-group">
                <strong>채우기</strong>
                <div className="canvas-segmented-options">
                  {canvasFillOptions.map((fill) => (
                    <button
                      key={fill.value}
                      type="button"
                      className={
                        activeCanvasFill === fill.value ? "is-active" : undefined
                      }
                      onClick={() => selectCanvasFill(fill.value)}
                    >
                      {fill.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="canvas-popover-group">
                <strong>테두리</strong>
                <div className="canvas-segmented-options">
                  {canvasDashOptions.map((dash) => (
                    <button
                      key={dash.value}
                      type="button"
                      className={
                        activeCanvasDash === dash.value ? "is-active" : undefined
                      }
                      onClick={() => selectCanvasDash(dash.value)}
                    >
                      {dash.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="canvas-popover-group">
                <strong>크기</strong>
                <div className="canvas-segmented-options">
                  {canvasSizeOptions.map((size) => (
                    <button
                      key={size.value}
                      type="button"
                      className={
                        activeCanvasSize === size.value ? "is-active" : undefined
                      }
                      onClick={() => selectCanvasSize(size.value)}
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="canvas-opacity-control">
                <span>
                  <strong>불투명도</strong>
                  <output>
                    {isCanvasOpacityMixed ? "혼합" : `${canvasOpacityPercent}%`}
                  </output>
                </span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={canvasOpacityPercent}
                  onBlur={commitCanvasOpacity}
                  onChange={(event) => {
                    setIsCanvasOpacityMixed(false);
                    setCanvasOpacityPercent(Number(event.target.value));
                  }}
                  onKeyUp={commitCanvasOpacity}
                  onPointerUp={commitCanvasOpacity}
                />
              </label>
            </section>
          ) : null}
        </div>

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
              label="핸드"
              active={isCanvasToolActive("hand")}
              onClick={() => selectCanvasTool("hand")}
            >
              <Hand />
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
                nativeTooltip
                active={activeDrawingPreset === "pen"}
                onClick={() => selectDrawingPreset("pen")}
              >
                <Pencil />
              </ToolButton>
              <ToolButton
                label="형광펜"
                agentTarget="toolbar.draw.highlight"
                nativeTooltip
                active={activeDrawingPreset === "highlight"}
                onClick={() => selectDrawingPreset("highlight")}
              >
                <Highlighter />
              </ToolButton>
              <ToolButton
                label="지우개"
                agentTarget="toolbar.draw.eraser"
                nativeTooltip
                active={activeDrawingPreset === "eraser"}
                onClick={() => selectDrawingPreset("eraser")}
              >
                <Eraser />
              </ToolButton>
              <div className="canvas-shape-option-grid">
                {canvasGeoShapeOptions.map((shape) => (
                  <ToolButton
                    key={shape.value}
                    label={shape.label}
                    nativeTooltip
                    active={activeDrawingPreset === shape.value}
                    onClick={() => selectShapePreset(shape.value)}
                  >
                    {shape.icon}
                  </ToolButton>
                ))}
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
                agentTarget="toolbar.line.arrow"
                nativeTooltip
                active={activeCanvasTool === "arrow"}
                onClick={() => selectCanvasTool("arrow")}
              >
                <ArrowRight />
              </ToolButton>
              <ToolButton
                label="직선"
                agentTarget="toolbar.line.line"
                nativeTooltip
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
                nativeTooltip
                onClick={openCanvasAiChat}
              >
                <Bot />
              </ToolButton>
              <ToolButton
                label="이미지"
                agentTarget="toolbar.more.image"
                nativeTooltip
                onClick={() => openMediaFilePicker("image")}
              >
                <Image />
              </ToolButton>
              <ToolButton
                label="비디오"
                agentTarget="toolbar.more.video"
                nativeTooltip
                onClick={() => openMediaFilePicker("video")}
              >
                <Video />
              </ToolButton>
              <ToolButton
                label="Drive 파일"
                nativeTooltip
                disabled={!shouldUseCanvasApi || !authSession?.accessToken}
                onClick={() => {
                  closePopover();
                  setIsDriveFilePickerOpen(true);
                }}
              >
                <Files />
              </ToolButton>
              <ToolButton
                label="북마크"
                agentTarget="toolbar.more.bookmark"
                nativeTooltip
                onClick={() => createInsertableShape("bookmark")}
              >
                <Bookmark />
              </ToolButton>
              <ToolButton
                label="임베드"
                agentTarget="toolbar.more.embed"
                nativeTooltip
                onClick={() => createInsertableShape("embed")}
              >
                <TvMinimalPlay />
              </ToolButton>
              {activeBoard?.engineType === "tldraw_sync" ? (
                <ToolButton
                  label="원본 classic Canvas"
                  agentTarget="toolbar.more.classic_canvas"
                  nativeTooltip
                  disabled={
                    !shouldUseCanvasApi ||
                    !activeBoard.sourceCanvasId ||
                    isReturningToClassicCanvas
                  }
                  onClick={returnToSourceClassicCanvas}
                >
                  <RotateCcw />
                </ToolButton>
              ) : null}
              {activeBoard?.engineType === "tldraw_sync" ? (
                <div className="canvas-realtime-version-hint">
                  현재 Canvas는 tldraw sync 모드입니다. 원본 classic Canvas는{" "}
                  {RETURN_TO_CLASSIC_CANVAS_SHORTCUT}로도 열 수 있습니다.
                </div>
              ) : null}
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
          <TldrawSyncCanvasRuntime
            key={`${board.workspaceId}:${board.id}:tldraw-sync`}
            board={board}
            canvasClient={shouldUseCanvasApi ? canvasClient : null}
            onHistoryStateChange={setCanvasHistoryState}
            onReady={setCanvasActions}
          />
        ) : (
          <ClassicCanvasRuntime
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
