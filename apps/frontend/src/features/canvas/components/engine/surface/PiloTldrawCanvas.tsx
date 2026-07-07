"use client";

import {
  useEffect,
  useRef,
  type MutableRefObject,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  type Editor,
  type TLShapeId,
  useEditor,
} from "tldraw";
import { useValue } from "@tldraw/state-react";
import { TldrawSurface } from "@/shared/tldraw";
import { PiloCanvasBackground } from "./PiloCanvasBackground";
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
  type PiloArrowBindingSnapshot,
} from "./pilo-canvas-arrow-bindings";
import type {
  PiloCanvasShapeDetailRequest,
  PiloCanvasFreeformShape,
  PiloCanvasViewportBounds,
  PiloCanvasViewSetting,
} from "../types";
import {
  sortFreeformShapesForCreate,
  type PiloInsertableTool,
} from "../shapes/pilo-canvas-shape-factory";
import { piloCanvasShapeUtils } from "../shapes/pilo-canvas-shape-utils";
import {
  placePiloCanvasShapeAt,
  type PiloPlacementRequest,
} from "../interactions/pilo-canvas-placement";
import type { PiloStickyNoteColor } from "../shapes/sticky-note/PiloStickyNoteShapeUtil";

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
  onViewportBoundsChange: (bounds: PiloCanvasViewportBounds) => void;
  onShapeDetailRequest: (request: PiloCanvasShapeDetailRequest) => void;
  onHistoryStateChange: (state: PiloCanvasHistoryState) => void;
  onSnapStateChange: (state: PiloCanvasSnapState) => void;
};

const tldrawComponents = {
  Background: PiloCanvasBackground,
};

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
  onViewportBoundsChange,
  onShapeDetailRequest,
  onHistoryStateChange,
  onSnapStateChange,
}: PiloTldrawCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const placementRequestRef = useRef<PiloPlacementRequest | null>(null);
  const pendingArrowBindingsRef = useRef<PiloArrowBindingSnapshot[]>([]);
  const piloDefaultArrowKindHydrationGuardRef = useRef(false);
  const createdLocalCardsRef = useRef(0);
  const freeformShapesRef = useRef(freeformShapes);
  const initialViewSettingRef = useRef(initialViewSetting);
  const seedKey = board.id;

  useEffect(() => {
    freeformShapesRef.current = freeformShapes;
  }, [freeformShapes]);

  useEffect(() => {
    initialViewSettingRef.current = initialViewSetting;
  }, [initialViewSetting]);

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
    return () => onReady(null);
  }, [onReady]);

  function handleCanvasWheel(event: WheelEvent<HTMLDivElement>) {
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
      onWheelCapture={handleCanvasWheel}
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
      <CanvasSnapStateReporter onSnapStateChange={onSnapStateChange} />
      <SelectedShapeStackingManager />
      <SelectedGroupToolbar />
      <FrameSelectionToolbar />
    </TldrawSurface>
  );
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
