"use client";

import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
} from "react";
import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  type Editor,
  type TLShape,
  type TLShapeId,
  useEditor,
} from "tldraw";
import { useValue } from "@tldraw/state-react";
import { TldrawSurface } from "@/shared/tldraw";
import type { CanvasPresenceController } from "@/features/canvas/realtime/useCanvasPresence";
import { RemoteCursorOverlay } from "@/features/canvas/realtime/RemoteCursorOverlay";
import type {
  CanvasPresencePoint,
  CanvasPresenceViewport,
} from "@/features/canvas/realtime/canvas-realtime-types";
import { PiloCanvasBackground } from "./PiloCanvasBackground";
import { PiloCollapsedFrameOverlay } from "./PiloCollapsedFrameOverlay";
import { SelectedShapeStackingManager } from "../interactions/PiloCanvasStackingManager";
import { SelectedGroupToolbar } from "../interactions/PiloCanvasGroupToolbar";
import {
  isPiloCodeBlockShape,
  isPiloFrameShape,
} from "../shapes/PiloCanvasShapeGuards";
import {
  FrameSelectionToolbar,
} from "../shapes/frame/PiloFrameSelectionToolbar";
import {
  normalizeBlankFrameName,
  resolveNextFrameName,
} from "../shapes/frame/PiloFrameShapeUtil";
import { restorePiloShapeAssets } from "../assets/pilo-canvas-assets";
import { CanvasStateReporter } from "./pilo-canvas-state-reporter";
import {
  readSerializedArrowBindings,
  restoreSerializedArrowBindings,
  withSerializedArrowBindings,
  type PiloArrowBindingSnapshot,
} from "./pilo-canvas-arrow-bindings";
import type {
  PiloCanvasShapeDetailRequest,
  PiloCanvasFreeformShape,
  PiloCanvasViewportBounds,
  PiloCanvasViewSetting,
} from "../types";
import {
  createImportedCodeFolderShapes,
  createImportedCodeBlockShape,
  PILO_IMPORTED_CODE_BLOCK_HEIGHT,
  PILO_IMPORTED_CODE_BLOCK_WIDTH,
  sortFreeformShapesForCreate,
  type PiloInsertableTool,
} from "../shapes/pilo-canvas-shape-factory";
import { piloCanvasShapeUtils } from "../shapes/pilo-canvas-shape-utils";
import {
  placePiloCanvasShapeAt,
  type PiloPlacementRequest,
} from "../interactions/pilo-canvas-placement";
import {
  hasCodeFileDrag,
  importCodeFilesFromDataTransfer,
  type PiloCodeFileImportResult,
} from "../interactions/pilo-canvas-file-import";
import type { PiloStickyNoteColor } from "../shapes/sticky-note/PiloStickyNoteShapeUtil";
import {
  PILO_CHILD_SHAPE_COUNT_META_KEY,
  PILO_FRAME_EXPANDED_SIZE_META_KEY,
  PILO_FRAME_COLLAPSED_META_KEY,
  getPiloFrameExpandedSize,
  getPiloChildShapeCount,
} from "../../../utils/canvas-collapse";

export type { PiloCanvasFreeformShape } from "../types";
export type { PiloInsertableTool } from "../shapes/pilo-canvas-shape-factory";

type CanvasBoardDetail = {
  id: string;
  title: string;
  shapeCount: number;
};

export type PiloCanvasTool =
  | "select"
  | "draw"
  | "text"
  | "arrow"
  | "line"
  | "geo"
  | "frame"
  | "code";

export type PiloDrawingPreset =
  | "pen"
  | "highlight"
  | "eraser"
  | "rectangle"
  | "circle"
  | "triangle"
  | "black"
  | "red"
  | "yellow"
  | "green"
  | "blue"
  | "violet";

const piloDrawingColorPresets = [
  "black",
  "red",
  "yellow",
  "green",
  "blue",
  "violet",
] as const;

function isPiloDrawingColorPreset(
  preset: PiloDrawingPreset,
): preset is (typeof piloDrawingColorPresets)[number] {
  return piloDrawingColorPresets.includes(
    preset as (typeof piloDrawingColorPresets)[number],
  );
}

export type PiloCanvasActions = {
  markUiEventAsHandled: (event: PointerEvent<HTMLElement>) => void;
  selectTool: (tool: PiloCanvasTool) => void;
  selectDrawingPreset: (preset: PiloDrawingPreset) => void;
  createInsertableShape: (tool: PiloInsertableTool, url: string) => void;
  groupSelection: () => void;
  setSmartGuidesEnabled: (enabled: boolean) => void;
  createStickyNote: (color?: PiloStickyNoteColor) => void;
  createStickyStack: (color?: PiloStickyNoteColor) => void;
  createCodeBlock: () => void;
  clearSelection: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  undo: () => void;
  redo: () => void;
};

export type PiloCanvasHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
};

export type PiloCanvasSnapState = {
  isSmartGuideEnabled: boolean;
};

type PiloTldrawCanvasProps = {
  board: CanvasBoardDetail;
  cameraRestoreVersion: number;
  hydrationVersion: number;
  initialViewSetting: PiloCanvasViewSetting;
  freeformShapes: PiloCanvasFreeformShape[];
  onReady: (actions: PiloCanvasActions | null) => void;
  onFreeformShapesDraftChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onFreeformShapesChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onViewChange: (viewSetting: PiloCanvasViewSetting) => void;
  onFrameChildShapesUnload: (shapes: PiloCanvasFreeformShape[]) => void;
  onFrameChildrenRequest: (frameId: string) => void;
  onViewportBoundsChange: (bounds: PiloCanvasViewportBounds) => void;
  onShapeDetailRequest: (request: PiloCanvasShapeDetailRequest) => void;
  onHistoryStateChange: (state: PiloCanvasHistoryState) => void;
  presence?: CanvasPresenceController;
  onSnapStateChange: (state: PiloCanvasSnapState) => void;
};

const tldrawComponents = {
  Background: PiloCanvasBackground,
};

const PILO_COLLAPSED_FRAME_SIZE = 144;

function collectSerializedArrowBindings(shapes: PiloCanvasFreeformShape[]) {
  return shapes.flatMap(readSerializedArrowBindings);
}

function uniquePendingArrowBindings(bindings: PiloArrowBindingSnapshot[]) {
  const bindingMap = new Map<string, PiloArrowBindingSnapshot>();

  bindings.forEach((binding) => {
    bindingMap.set(
      [
        binding.id ?? "",
        binding.fromId,
        binding.toId,
        binding.props.terminal,
      ].join("|"),
      binding,
    );
  });

  return Array.from(bindingMap.values());
}

function createFreeformShapeRecords(
  editor: Editor,
  shapes: PiloCanvasFreeformShape[],
  pendingArrowBindingsRef: MutableRefObject<PiloArrowBindingSnapshot[]>,
  piloDefaultArrowKindHydrationGuardRef: MutableRefObject<boolean>,
) {
  if (!shapes.length) return;

  restorePiloShapeAssets(editor, shapes);
  piloDefaultArrowKindHydrationGuardRef.current = true;
  try {
    editor.createShapes(sortFreeformShapesForCreate(shapes));
  } finally {
    piloDefaultArrowKindHydrationGuardRef.current = false;
  }

  const bindingsToRestore = uniquePendingArrowBindings([
    ...pendingArrowBindingsRef.current,
    ...collectSerializedArrowBindings(shapes),
  ]);

  if (!bindingsToRestore.length) return;

  const result = restoreSerializedArrowBindings(editor, bindingsToRestore);
  pendingArrowBindingsRef.current = uniquePendingArrowBindings(result.pending);
}

function hydrateFreeformShapes(
  editor: Editor,
  shapes: PiloCanvasFreeformShape[],
  pendingArrowBindingsRef: MutableRefObject<PiloArrowBindingSnapshot[]>,
  piloDefaultArrowKindHydrationGuardRef: MutableRefObject<boolean>,
) {
  editor.run(
    () =>
      createFreeformShapeRecords(
        editor,
        shapes,
        pendingArrowBindingsRef,
        piloDefaultArrowKindHydrationGuardRef,
      ),
    {
      history: "ignore",
    },
  );
}

function applyViewSetting(editor: Editor, viewSetting: PiloCanvasViewSetting) {
  if (
    !Number.isFinite(viewSetting.zoom) ||
    !Number.isFinite(viewSetting.viewportX) ||
    !Number.isFinite(viewSetting.viewportY)
  ) {
    return;
  }

  editor.setCamera({
    x: viewSetting.viewportX,
    y: viewSetting.viewportY,
    z: viewSetting.zoom,
  });
}

function resetFreeformShapes(
  editor: Editor,
  shapes: PiloCanvasFreeformShape[],
  pendingArrowBindingsRef: MutableRefObject<PiloArrowBindingSnapshot[]>,
  piloDefaultArrowKindHydrationGuardRef: MutableRefObject<boolean>,
) {
  editor.run(
    () => {
      pendingArrowBindingsRef.current = [];
      const existingFreeformShapeIds = editor
        .getCurrentPageShapes()
        .map((shape) => shape.id as TLShapeId);

      if (existingFreeformShapeIds.length) {
        editor.deleteShapes(existingFreeformShapeIds);
      }

      createFreeformShapeRecords(
        editor,
        shapes,
        pendingArrowBindingsRef,
        piloDefaultArrowKindHydrationGuardRef,
      );
    },
    { history: "ignore" },
  );
}

function collectFrameDescendantShapes(editor: Editor, frameId: TLShapeId) {
  const shapes = editor.getCurrentPageShapes();
  const descendantIds = new Set<TLShapeId>();
  let didAddShape = true;

  while (didAddShape) {
    didAddShape = false;

    shapes.forEach((shape) => {
      if (shape.id === frameId || descendantIds.has(shape.id)) return;

      const parentId = shape.parentId as TLShapeId | undefined;
      if (parentId !== frameId && !descendantIds.has(parentId as TLShapeId)) {
        return;
      }

      descendantIds.add(shape.id);
      didAddShape = true;
    });
  }

  return shapes.filter((shape) => descendantIds.has(shape.id));
}

function registerCanvasEditorSideEffects(
  editor: Editor,
  piloDefaultArrowKindHydrationGuardRef: MutableRefObject<boolean>,
) {
  editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
    if (
      shape.type === "arrow" &&
      !piloDefaultArrowKindHydrationGuardRef.current &&
      shape.props.kind !== "elbow"
    ) {
      return {
        ...shape,
        props: {
          ...shape.props,
          kind: "elbow",
        },
      };
    }

    if (!isPiloFrameShape(shape) || shape.props.name.trim()) return shape;

    return {
      ...shape,
      props: {
        ...shape.props,
        name: resolveNextFrameName(editor),
      },
    };
  });

  editor.sideEffects.registerBeforeChangeHandler("shape", (prev, next) => {
    let nextShape = next;

    if (isPiloFrameShape(nextShape)) {
      const shouldNormalizeFrameName =
        prev.type !== "frame" || prev.props.name !== nextShape.props.name;

      if (shouldNormalizeFrameName) {
        const normalizedName = normalizeBlankFrameName(nextShape.props.name);

        if (normalizedName !== nextShape.props.name) {
          nextShape = {
            ...nextShape,
            props: {
              ...nextShape.props,
              name: normalizedName,
            },
          };
        }
      }
    }

    return nextShape;
  });
}

export function PiloTldrawCanvas({
  board,
  cameraRestoreVersion,
  freeformShapes,
  hydrationVersion,
  initialViewSetting,
  onReady,
  onFreeformShapesDraftChange,
  onFreeformShapesChange,
  onViewChange,
  onFrameChildShapesUnload,
  onFrameChildrenRequest,
  onViewportBoundsChange,
  onShapeDetailRequest,
  onHistoryStateChange,
  presence,
  onSnapStateChange,
}: PiloTldrawCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const placementRequestRef = useRef<PiloPlacementRequest | null>(null);
  const pendingArrowBindingsRef = useRef<PiloArrowBindingSnapshot[]>([]);
  const piloDefaultArrowKindHydrationGuardRef = useRef(false);
  const createdLocalCardsRef = useRef(0);
  const freeformShapesRef = useRef(freeformShapes);
  const canvasWheelCleanupRef = useRef<(() => void) | null>(null);
  const frameChildrenRequestTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialViewSettingRef = useRef(initialViewSetting);
  const seedKey = board.id;

  useEffect(() => {
    freeformShapesRef.current = freeformShapes;
  }, [freeformShapes]);

  useEffect(() => {
    initialViewSettingRef.current = initialViewSetting;
  }, [initialViewSetting]);

  useEffect(
    () => () => {
      if (frameChildrenRequestTimerRef.current) {
        clearTimeout(frameChildrenRequestTimerRef.current);
        frameChildrenRequestTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) return;

    resetFreeformShapes(
      editor,
      freeformShapesRef.current,
      pendingArrowBindingsRef,
      piloDefaultArrowKindHydrationGuardRef,
    );
  }, [hydrationVersion, seedKey]);

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) return;

    applyViewSetting(editor, initialViewSettingRef.current);
  }, [cameraRestoreVersion, seedKey]);

  function mountEditor(editor: Editor) {
    editorRef.current = editor;
    canvasWheelCleanupRef.current?.();

    const canvasContainer = editor.getContainer();
    canvasContainer.addEventListener("wheel", handleCanvasWheel, {
      capture: true,
      passive: false,
    });
    canvasWheelCleanupRef.current = () => {
      canvasContainer.removeEventListener("wheel", handleCanvasWheel, {
        capture: true,
      });
    };

    registerCanvasEditorSideEffects(
      editor,
      piloDefaultArrowKindHydrationGuardRef,
    );
    hydrateFreeformShapes(
      editor,
      freeformShapes,
      pendingArrowBindingsRef,
      piloDefaultArrowKindHydrationGuardRef,
    );
    applyViewSetting(editor, initialViewSetting);

    onReady({
      markUiEventAsHandled(event) {
        editor.markEventAsHandled(event);
        event.stopPropagation();
      },
      selectTool(tool) {
        placementRequestRef.current = null;
        editor.cancel();
        editor.setCurrentTool(tool === "select" ? "select.idle" : tool);
      },
      selectDrawingPreset(preset) {
        placementRequestRef.current = null;
        editor.cancel();

        if (preset === "highlight") {
          editor.setStyleForNextShapes(DefaultColorStyle, "yellow");
          editor.setStyleForNextShapes(DefaultSizeStyle, "xl");
          editor.setCurrentTool("highlight");
          return;
        }

        if (preset === "eraser") {
          editor.setCurrentTool("eraser");
          return;
        }

        if (preset === "rectangle") {
          editor.setStyleForNextShapes(GeoShapeGeoStyle, "rectangle");
          editor.setCurrentTool("geo");
          return;
        }

        if (preset === "circle") {
          editor.setStyleForNextShapes(GeoShapeGeoStyle, "ellipse");
          editor.setCurrentTool("geo");
          return;
        }

        if (preset === "triangle") {
          editor.setStyleForNextShapes(GeoShapeGeoStyle, "triangle");
          editor.setCurrentTool("geo");
          return;
        }

        if (isPiloDrawingColorPreset(preset)) {
          editor.setStyleForNextShapes(DefaultColorStyle, preset);
          editor.setCurrentTool("draw");
          return;
        }

        editor.setStyleForNextShapes(DefaultColorStyle, "blue");
        editor.setStyleForNextShapes(DefaultDashStyle, "draw");
        editor.setStyleForNextShapes(DefaultSizeStyle, "m");
        editor.setCurrentTool("draw");
      },
      createStickyNote(color) {
        editor.cancel();
        editor.setCurrentTool("select.idle");
        placementRequestRef.current = {
          type: "sticky",
          color,
        };
      },
      createStickyStack(color) {
        editor.cancel();
        editor.setCurrentTool("select.idle");
        placementRequestRef.current = {
          type: "sticky-stack",
          color,
        };
      },
      createCodeBlock() {
        editor.cancel();
        editor.setCurrentTool("select.idle");
        placementRequestRef.current = {
          type: "code",
        };
      },
      createInsertableShape(tool, url) {
        editor.cancel();
        editor.setCurrentTool("select.idle");
        placementRequestRef.current = {
          type: tool,
          url,
        };
      },
      groupSelection() {
        const selectedShapeIds = editor.getSelectedShapeIds();

        if (selectedShapeIds.length < 2) return;

        editor.groupShapes(selectedShapeIds);
      },
      setSmartGuidesEnabled(enabled) {
        editor.user.updateUserPreferences({ isSnapMode: enabled });
      },
      clearSelection() {
        placementRequestRef.current = null;
        editor.selectNone();
      },
      fit() {
        editor.zoomToFit({ animation: { duration: 180 } });
      },
      zoomIn() {
        editor.zoomIn(editor.getViewportScreenCenter(), {
          animation: { duration: 120 },
        });
      },
      zoomOut() {
        editor.zoomOut(editor.getViewportScreenCenter(), {
          animation: { duration: 120 },
        });
      },
      undo() {
        editor.undo();
      },
      redo() {
        editor.redo();
      },
    });
  }

  useEffect(() => {
    return () => {
      canvasWheelCleanupRef.current?.();
      canvasWheelCleanupRef.current = null;
      onReady(null);
    };
  }, [onReady]);

  function handleCanvasWheel(event: globalThis.WheelEvent) {
    const editor = editorRef.current;

    if (!editor) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        ".pilo-code-block input, .pilo-code-block select, .pilo-code-mirror, .pilo-sticky-note p, .pilo-sticky-note textarea",
      )
    ) {
      return;
    }

    const deltaMultiplier =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
    const normalizedDelta = event.deltaY * deltaMultiplier;
    const cursorPagePoint = editor.screenToPage({
      x: event.clientX,
      y: event.clientY,
    });

    event.preventDefault();
    event.stopPropagation();

    const currentCamera = editor.getCamera();
    const nextZoom = Math.min(
      8,
      Math.max(0.12, currentCamera.z * Math.exp(-normalizedDelta * 0.0012)),
    );

    if (Math.abs(nextZoom - currentCamera.z) < 0.001) return;

    const viewportBounds = editor.getViewportScreenBounds();

    editor.setCamera({
      x: (event.clientX - viewportBounds.x) / nextZoom - cursorPagePoint.x,
      y: (event.clientY - viewportBounds.y) / nextZoom - cursorPagePoint.y,
      z: nextZoom,
    });
  }

  function placePendingShapeAt(point: { x: number; y: number }) {
    const editor = editorRef.current;
    const placementRequest = placementRequestRef.current;

    if (!editor || !placementRequest) return false;

    placementRequestRef.current = null;
    const result = placePiloCanvasShapeAt({
      editor,
      index: createdLocalCardsRef.current + 1,
      placementRequest,
      point,
    });

    if (result.placed) {
      createdLocalCardsRef.current += result.createdCount;
    }

    return result.placed;
  }

  function requestShapeDetail(editor: Editor, shapeId: TLShapeId) {
    onShapeDetailRequest({
      shapeId: String(shapeId),
      zoom: editor.getCamera().z,
    });
  }

  const handleFrameCollapsedChange = useCallback(
    (frame: Extract<TLShape, { type: "frame" }>, nextCollapsed: boolean) => {
      const editor = editorRef.current;

      if (!editor) return;

      const currentFrame = editor.getShape(frame.id);
      const frameShape = isPiloFrameShape(currentFrame) ? currentFrame : frame;
      const descendantShapes = nextCollapsed
        ? collectFrameDescendantShapes(editor, frameShape.id)
        : [];
      const descendantSnapshots = descendantShapes.map((shape) =>
        withSerializedArrowBindings(editor, shape),
      );
      const childShapeCount = Math.max(
        getPiloChildShapeCount(frameShape),
        descendantSnapshots.length,
      );
      const expandedSize = getPiloFrameExpandedSize(frameShape);
      const currentFrameSize = {
        h: frameShape.props.h,
        w: frameShape.props.w,
      };
      const nextFrameProps = nextCollapsed
        ? {
            h: PILO_COLLAPSED_FRAME_SIZE,
            w: PILO_COLLAPSED_FRAME_SIZE,
          }
        : expandedSize
          ? {
              h: expandedSize.h,
              w: expandedSize.w,
            }
          : undefined;

      if (nextCollapsed && descendantSnapshots.length) {
        onFrameChildShapesUnload(descendantSnapshots);
      }

      editor.run(
        () => {
          if (nextCollapsed && descendantShapes.length) {
            editor.deleteShapes(
              descendantShapes.map((shape) => shape.id as TLShapeId),
            );
          }

          editor.updateShapes([
            {
              id: frameShape.id,
              type: frameShape.type,
              ...(nextFrameProps ? { props: nextFrameProps } : {}),
              meta: {
                ...(frameShape.meta ?? {}),
                [PILO_FRAME_COLLAPSED_META_KEY]: nextCollapsed,
                [PILO_CHILD_SHAPE_COUNT_META_KEY]: childShapeCount,
                ...(nextCollapsed
                  ? {
                      [PILO_FRAME_EXPANDED_SIZE_META_KEY]: currentFrameSize,
                    }
                  : {}),
              },
            },
          ]);

          editor.select(frameShape.id);
        },
        { history: "ignore" },
      );

      onFreeformShapesDraftChange(
        editor
          .getCurrentPageShapes()
          .map((shape) => withSerializedArrowBindings(editor, shape)),
      );

      if (!nextCollapsed) {
        if (frameChildrenRequestTimerRef.current) {
          clearTimeout(frameChildrenRequestTimerRef.current);
        }

        frameChildrenRequestTimerRef.current = setTimeout(() => {
          frameChildrenRequestTimerRef.current = null;
          onFrameChildrenRequest(String(frameShape.id));
        }, 0);
      }
    },
    [
      onFrameChildShapesUnload,
      onFrameChildrenRequest,
      onFreeformShapesDraftChange,
    ],
  );

  function handleCanvasPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
    const editor = editorRef.current;

    if (!editor || event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        ".pilo-frame-toolbar, .tl-frame-heading, .tl-frame-heading-hit-area, .tl-frame-label, .tl-frame-name-input, .pilo-code-block input, .pilo-code-block select, .pilo-code-mirror",
      )
    ) {
      return;
    }

    const pagePoint = editor.screenToPage({
      x: event.clientX,
      y: event.clientY,
    });

    if (placementRequestRef.current) {
      if (placePendingShapeAt(pagePoint)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    const directShape = editor.getShapeAtPoint(pagePoint, {
      hitInside: true,
      hitLabels: true,
      hitLocked: true,
    });

    if (isPiloCodeBlockShape(directShape)) {
      if (!editor.getSelectedShapeIds().includes(directShape.id)) {
        editor.setCurrentTool("select");
        editor.select(directShape.id);
      }

      requestShapeDetail(editor, directShape.id);
      return;
    }

    if (directShape && !isPiloFrameShape(directShape)) {
      requestShapeDetail(editor, directShape.id as TLShapeId);
      return;
    }

    const frameShape = isPiloFrameShape(directShape)
      ? directShape
      : editor.getShapeAtPoint(pagePoint, {
          filter: isPiloFrameShape,
          hitFrameInside: true,
          hitLabels: true,
          hitLocked: true,
        });

    if (!isPiloFrameShape(frameShape)) return;
    if (
      !frameShape.isLocked &&
      editor.getSelectedShapeIds().includes(frameShape.id)
    ) {
      requestShapeDetail(editor, frameShape.id);
      return;
    }

    editor.setCurrentTool("select");
    editor.select(frameShape.id);
    requestShapeDetail(editor, frameShape.id);
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <TldrawSurface
      className="pilo-tldraw-canvas"
      hideUi
      licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
      shapeUtils={piloCanvasShapeUtils}
      components={tldrawComponents}
      onMount={mountEditor}
      onPointerDownCapture={handleCanvasPointerDownCapture}
    >
      <CanvasStateReporter
        onFreeformShapesDraftChange={onFreeformShapesDraftChange}
        onFreeformShapesChange={onFreeformShapesChange}
        onViewChange={onViewChange}
        onViewportBoundsChange={onViewportBoundsChange}
      />
      <CanvasHistoryStateReporter
        onHistoryStateChange={onHistoryStateChange}
      />
      <CanvasFileDropImporter />
      {presence?.enabled ? <CanvasPresenceReporter presence={presence} /> : null}
      {presence ? (
        <RemoteCursorOverlay
          currentUserId={presence.currentUserId}
          presence={presence.remotePresence}
        />
      ) : null}
      <CanvasSnapStateReporter onSnapStateChange={onSnapStateChange} />
      <SelectedShapeStackingManager />
      <SelectedGroupToolbar />
      <PiloCollapsedFrameOverlay
        onFrameCollapsedChange={handleFrameCollapsedChange}
      />
      <FrameSelectionToolbar
        onFrameCollapsedChange={handleFrameCollapsedChange}
      />
    </TldrawSurface>
  );
}

const PILO_CODE_IMPORT_GRID_GAP_X = 56;
const PILO_CODE_IMPORT_GRID_GAP_Y = 64;
const PILO_CODE_IMPORT_MAX_COLUMNS = 3;

function getCodeImportGridPosition({
  count,
  index,
  point,
}: {
  count: number;
  index: number;
  point: { x: number; y: number };
}) {
  const columns = Math.min(
    PILO_CODE_IMPORT_MAX_COLUMNS,
    Math.max(1, Math.ceil(Math.sqrt(count))),
  );
  const column = index % columns;
  const row = Math.floor(index / columns);
  const totalWidth =
    columns * PILO_IMPORTED_CODE_BLOCK_WIDTH +
    (columns - 1) * PILO_CODE_IMPORT_GRID_GAP_X;
  const x =
    point.x -
    totalWidth / 2 +
    column * (PILO_IMPORTED_CODE_BLOCK_WIDTH + PILO_CODE_IMPORT_GRID_GAP_X);
  const y =
    point.y -
    PILO_IMPORTED_CODE_BLOCK_HEIGHT / 2 +
    row * (PILO_IMPORTED_CODE_BLOCK_HEIGHT + PILO_CODE_IMPORT_GRID_GAP_Y);

  return { x, y };
}

function summarizeImportItems(items: { fileName: string; reason: string }[]) {
  if (!items.length) return "";

  const preview = items
    .slice(0, 3)
    .map((item) => item.fileName)
    .join(", ");
  const remainingCount = items.length - 3;

  return remainingCount > 0 ? `${preview} 외 ${remainingCount}개` : preview;
}

function getImportedFolderCodeBlockCount(
  folder: PiloCodeFileImportResult["folders"][number],
): number {
  return (
    folder.files.length +
    folder.folders.reduce(
      (count, childFolder) =>
        count + getImportedFolderCodeBlockCount(childFolder),
      0,
    )
  );
}

function getImportedCodeBlockCount(summary: PiloCodeFileImportResult) {
  return (
    summary.imported.length +
    summary.folders.reduce(
      (count, folder) => count + getImportedFolderCodeBlockCount(folder),
      0,
    )
  );
}

function getCodeFileDropSignature(dataTransfer: DataTransfer) {
  const files = Array.from(dataTransfer.files);

  if (files.length) {
    return files
      .map((file) => [file.name, file.size, file.lastModified].join(":"))
      .join("|");
  }

  return `items:${dataTransfer.items.length}`;
}

function CanvasFileDropImporter() {
  const editor = useEditor();
  const importIndexRef = useRef(0);
  const dragDepthRef = useRef(0);
  const lastDropRef = useRef<{ signature: string; time: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [summary, setSummary] = useState<PiloCodeFileImportResult | null>(null);

  useEffect(() => {
    if (!summary) return undefined;

    const timer = window.setTimeout(() => setSummary(null), 6000);

    return () => window.clearTimeout(timer);
  }, [summary]);

  useEffect(() => {
    const container = editor.getContainer();
    const dropTarget = (container.closest(".pilo-tldraw-canvas") ??
      container) as HTMLElement;
    const listenerOptions: AddEventListenerOptions = { capture: true };

    function handleDragEnter(event: globalThis.DragEvent) {
      if (!hasCodeFileDrag(event.dataTransfer)) return;

      event.stopImmediatePropagation();
      dragDepthRef.current += 1;
      setIsDraggingFile(true);
    }

    function handleDragOver(event: globalThis.DragEvent) {
      if (!hasCodeFileDrag(event.dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    }

    function handleDragLeave(event: globalThis.DragEvent) {
      if (!hasCodeFileDrag(event.dataTransfer)) return;

      event.stopImmediatePropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

      if (dragDepthRef.current === 0) {
        setIsDraggingFile(false);
      }
    }

    async function handleDrop(event: globalThis.DragEvent) {
      if (!hasCodeFileDrag(event.dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const dataTransfer = event.dataTransfer;
      const signature = getCodeFileDropSignature(dataTransfer);
      const now = Date.now();
      const lastDrop = lastDropRef.current;

      if (
        lastDrop &&
        lastDrop.signature === signature &&
        now - lastDrop.time < 900
      ) {
        return;
      }

      lastDropRef.current = {
        signature,
        time: now,
      };
      dragDepthRef.current = 0;
      setIsDraggingFile(false);
      setIsImporting(true);
      setSummary(null);

      try {
        const result = await importCodeFilesFromDataTransfer(dataTransfer);

        if (result.imported.length || result.folders.length) {
          const pagePoint = editor.screenToPage({
            x: event.clientX,
            y: event.clientY,
          });
          const rootFilePoint = result.folders.length
            ? {
                x: pagePoint.x,
                y:
                  pagePoint.y +
                  PILO_IMPORTED_CODE_BLOCK_HEIGHT +
                  PILO_CODE_IMPORT_GRID_GAP_Y,
              }
            : pagePoint;
          const rootFileShapes = result.imported.map((file, index) =>
            createImportedCodeBlockShape(
              importIndexRef.current + index,
              getCodeImportGridPosition({
                count: result.imported.length,
                index,
                point: rootFilePoint,
              }),
              file,
            ),
          );
          const folderShapes: PiloCanvasFreeformShape[] = [];
          const topLevelFrames: PiloCanvasFreeformShape[] = [];
          let nextFolderCenterX = pagePoint.x;
          let folderShapeIndex = importIndexRef.current + rootFileShapes.length;

          result.folders.forEach((folder) => {
            const createdFolder = createImportedCodeFolderShapes(
              folderShapeIndex,
              {
                x: nextFolderCenterX,
                y: pagePoint.y,
              },
              folder,
            );

            topLevelFrames.push(createdFolder.frame);
            folderShapes.push(...createdFolder.shapes);
            nextFolderCenterX += createdFolder.frameSize.w + 96;
            folderShapeIndex += createdFolder.shapes.length;
          });
          const shapes = [...folderShapes, ...rootFileShapes];
          const selectedShapes = topLevelFrames.length
            ? [...topLevelFrames, ...rootFileShapes]
            : shapes;

          editor.createShapes(sortFreeformShapesForCreate(shapes));
          editor.select(...selectedShapes.map((shape) => shape.id as TLShapeId));
          importIndexRef.current += shapes.length;
        }

        setSummary({
          ...result,
        });
      } catch {
        setSummary({
          failed: [
            {
              fileName: "파일 드롭",
              reason: "파일 import 처리 중 오류가 발생했습니다.",
            },
          ],
          folders: [],
          imported: [],
          skipped: [],
        });
      } finally {
        setIsImporting(false);
      }
    }

    dropTarget.addEventListener("dragenter", handleDragEnter, listenerOptions);
    dropTarget.addEventListener("dragover", handleDragOver, listenerOptions);
    dropTarget.addEventListener("dragleave", handleDragLeave, listenerOptions);
    dropTarget.addEventListener("drop", handleDrop, listenerOptions);

    return () => {
      dropTarget.removeEventListener(
        "dragenter",
        handleDragEnter,
        listenerOptions,
      );
      dropTarget.removeEventListener(
        "dragover",
        handleDragOver,
        listenerOptions,
      );
      dropTarget.removeEventListener(
        "dragleave",
        handleDragLeave,
        listenerOptions,
      );
      dropTarget.removeEventListener("drop", handleDrop, listenerOptions);
    };
  }, [editor]);

  return (
    <>
      {isDraggingFile ? (
        <div className="pilo-code-file-drop-overlay" aria-hidden="true">
          <strong>Code Block으로 가져오기</strong>
        </div>
      ) : null}
      {isImporting || summary ? (
        <div
          className="pilo-code-file-import-toast"
          role="status"
          aria-live="polite"
        >
          {isImporting ? (
            <strong>파일을 읽는 중</strong>
          ) : summary ? (
            <>
              <strong>
                Code Block {getImportedCodeBlockCount(summary)}개 생성
              </strong>
              {summary.skipped.length ? (
                <span>
                  제외 {summary.skipped.length}개:{" "}
                  {summarizeImportItems(summary.skipped)}
                </span>
              ) : null}
              {summary.failed.length ? (
                <span>
                  실패 {summary.failed.length}개:{" "}
                  {summarizeImportItems(summary.failed)}
                </span>
              ) : null}
              <button type="button" onClick={() => setSummary(null)}>
                닫기
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function hasSameSelectedShapeIds(
  previousShapeIds: string[],
  nextShapeIds: string[],
) {
  if (previousShapeIds.length !== nextShapeIds.length) {
    return false;
  }

  return previousShapeIds.every(
    (shapeId, index) => shapeId === nextShapeIds[index],
  );
}

function hasCursorMovedEnough(
  previousCursor: CanvasPresencePoint | null,
  nextCursor: CanvasPresencePoint,
) {
  if (!previousCursor) {
    return true;
  }

  return (
    Math.hypot(
      nextCursor.x - previousCursor.x,
      nextCursor.y - previousCursor.y,
    ) >= 1.5
  );
}

function getCanvasPresenceViewport(editor: Editor): CanvasPresenceViewport {
  const viewportBounds = editor.getViewportPageBounds();

  return {
    height: viewportBounds.h,
    width: viewportBounds.w,
    x: viewportBounds.x,
    y: viewportBounds.y,
    zoom: editor.getCamera().z,
  };
}

function CanvasPresenceReporter({
  presence,
}: {
  presence: CanvasPresenceController;
}) {
  const editor = useEditor();
  const sendPresenceUpdate = presence.sendPresenceUpdate;
  const selectedShapeIds = useValue(
    "pilo-presence-selected-shape-ids",
    () => editor.getSelectedShapeIds().map(String),
    [editor],
  );
  const selectedShapeIdsRef = useRef<string[]>(selectedShapeIds);
  const lastSentAtRef = useRef(0);
  const lastSentPayloadRef = useRef<{
    cursor: CanvasPresencePoint | null;
    selectedShapeIds: string[];
  }>({
    cursor: null,
    selectedShapeIds: [],
  });
  const pendingCursorRef = useRef<CanvasPresencePoint | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    selectedShapeIdsRef.current = selectedShapeIds;
  }, [selectedShapeIds]);

  const flushPresence = useCallback(
    (cursor: CanvasPresencePoint) => {
      const nextSelectedShapeIds = selectedShapeIdsRef.current;
      const lastPayload = lastSentPayloadRef.current;

      if (
        !hasCursorMovedEnough(lastPayload.cursor, cursor) &&
        hasSameSelectedShapeIds(
          lastPayload.selectedShapeIds,
          nextSelectedShapeIds,
        )
      ) {
        return;
      }

      sendPresenceUpdate(
        cursor,
        nextSelectedShapeIds,
        getCanvasPresenceViewport(editor),
      );
      lastSentAtRef.current = Date.now();
      lastSentPayloadRef.current = {
        cursor,
        selectedShapeIds: nextSelectedShapeIds,
      };
    },
    [editor, sendPresenceUpdate],
  );

  const schedulePresence = useCallback(
    (cursor: CanvasPresencePoint) => {
      pendingCursorRef.current = cursor;

      const elapsedMs = Date.now() - lastSentAtRef.current;
      if (elapsedMs >= 80) {
        if (pendingTimerRef.current) {
          window.clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }

        flushPresence(cursor);
        return;
      }

      if (pendingTimerRef.current) {
        return;
      }

      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        const pendingCursor = pendingCursorRef.current;

        if (pendingCursor) {
          flushPresence(pendingCursor);
        }
      }, 80 - elapsedMs);
    },
    [flushPresence],
  );

  useEffect(() => {
    if (!presence.enabled) {
      return undefined;
    }

    const container = editor.getContainer();

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (event.isPrimary === false) {
        return;
      }

      const pagePoint = editor.screenToPage({
        x: event.clientX,
        y: event.clientY,
      });

      schedulePresence({ x: pagePoint.x, y: pagePoint.y });
    }

    container.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    return () => {
      container.removeEventListener("pointermove", handlePointerMove);
      if (pendingTimerRef.current) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingCursorRef.current = null;
    };
  }, [editor, presence.enabled, schedulePresence]);

  return null;
}

function CanvasHistoryStateReporter({
  onHistoryStateChange,
}: {
  onHistoryStateChange: (state: PiloCanvasHistoryState) => void;
}) {
  const editor = useEditor();
  const canUndo = useValue("pilo-can-undo", () => editor.getCanUndo(), [
    editor,
  ]);
  const canRedo = useValue("pilo-can-redo", () => editor.getCanRedo(), [
    editor,
  ]);

  useEffect(() => {
    onHistoryStateChange({ canUndo, canRedo });
  }, [canRedo, canUndo, onHistoryStateChange]);

  useEffect(() => {
    return () => onHistoryStateChange({ canUndo: false, canRedo: false });
  }, [onHistoryStateChange]);

  return null;
}

function CanvasSnapStateReporter({
  onSnapStateChange,
}: {
  onSnapStateChange: (state: PiloCanvasSnapState) => void;
}) {
  const editor = useEditor();
  const isSmartGuideEnabled = useValue(
    "pilo-smart-guide-enabled",
    () => editor.user.getIsSnapMode(),
    [editor],
  );

  useEffect(() => {
    onSnapStateChange({ isSmartGuideEnabled });
  }, [isSmartGuideEnabled, onSnapStateChange]);

  useEffect(() => {
    return () => onSnapStateChange({ isSmartGuideEnabled: false });
  }, [onSnapStateChange]);

  return null;
}
