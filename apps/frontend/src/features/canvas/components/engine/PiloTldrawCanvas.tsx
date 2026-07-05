"use client";

import {
  useEffect,
  useRef,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  createCustomRecordId,
  createShapeId,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  Tldraw,
  useEditor,
  type Editor,
  type TLAsset,
  type TLAssetId,
  type TLCreateShapePartial,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { useValue } from "@tldraw/state-react";
import { PiloCanvasBackground } from "./PiloCanvasBackground";
import {
  PiloCodeBlockShapeUtil,
  type PiloCodeBlockShape,
} from "./PiloCodeBlockShapeUtil";
import {
  PiloStickyNoteShapeUtil,
  type PiloStickyNoteColor,
  type PiloStickyNoteShape,
} from "./PiloStickyNoteShapeUtil";
import { SelectedShapeStackingManager } from "./PiloCanvasStackingManager";
import {
  applyPiloSmartSnap,
  SmartGuidesOverlay,
} from "./PiloCanvasSmartGuides";
import {
  isPiloCodeBlockShape,
  isPiloFrameShape,
} from "./PiloCanvasShapeGuards";
import {
  FrameSelectionToolbar,
  normalizeBlankFrameName,
  PiloFrameShapeUtil,
  resolveNextFrameName,
} from "./PiloFrameSelectionToolbar";

type CanvasBoardDetail = {
  id: string;
  title: string;
  shapeCount: number;
};

type CanvasViewSetting = {
  zoom: number;
  viewportX: number;
  viewportY: number;
};

export type PiloCanvasFreeformShape = TLCreateShapePartial<TLShape>;

export type PiloCanvasTool =
  | "select"
  | "hand"
  | "draw"
  | "text"
  | "arrow"
  | "line"
  | "geo"
  | "frame"
  | "code";

export type PiloInsertableTool = "image" | "video" | "bookmark" | "embed";

export type PiloDrawingPreset =
  | "pen"
  | "highlight"
  | "eraser"
  | "frame"
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

type PiloMediaAsset = Extract<TLAsset, { type: "image" | "video" }>;
type PiloShapeWithMediaAssetMeta = TLShape & {
  meta: TLShape["meta"] & {
    piloAsset?: PiloMediaAsset;
  };
};

type PiloTldrawCanvasProps = {
  board: CanvasBoardDetail;
  hydrationVersion: number;
  freeformShapes: PiloCanvasFreeformShape[];
  onReady: (actions: PiloCanvasActions | null) => void;
  onFreeformShapesChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onViewChange: (viewSetting: CanvasViewSetting) => void;
};

type PiloStickyNotePartial = TLCreateShapePartial<PiloStickyNoteShape> & {
  id: TLShapeId;
};
type PiloCodeBlockPartial = TLCreateShapePartial<PiloCodeBlockShape> & {
  id: TLShapeId;
};
type PiloPlacementRequest =
  | {
      type: "sticky";
      color?: PiloStickyNoteColor;
    }
  | {
      type: "sticky-stack";
      color?: PiloStickyNoteColor;
    }
  | {
      type: "code";
    }
  | {
      type: PiloInsertableTool;
      url: string;
    };

const shapeUtils = [
  PiloFrameShapeUtil,
  PiloStickyNoteShapeUtil,
  PiloCodeBlockShapeUtil,
  // TODO(file_node): register the file_node ShapeUtil here after it has
  // rendering, props, geometry, and creation actions.
];
const tldrawComponents = {
  Background: PiloCanvasBackground,
};

function createStickyNoteShape(
  index: number,
  position: { x: number; y: number },
  color: PiloStickyNoteColor = "butter",
): PiloStickyNotePartial {
  const width = 156;
  const height = 148;
  const offset = index * 10;

  return {
    id: createShapeId(`pilo-sticky-${Date.now()}-${index}`),
    type: "pilo-sticky-note",
    x: position.x - width / 2 + offset,
    y: position.y - height / 2 + offset,
    props: {
      w: width,
      h: height,
      color,
      text: "",
    },
  };
}

function createCodeBlockShape(
  index: number,
  position: { x: number; y: number },
): PiloCodeBlockPartial {
  const width = 420;
  const height = 260;

  return {
    id: createShapeId(`pilo-code-${Date.now()}-${index}`),
    type: "pilo-code-block",
    x: position.x - width / 2,
    y: position.y - height / 2,
    props: {
      w: width,
      h: height,
      fileName: "canvas-node.tsx",
      language: "tsx",
      code: "export function CanvasNode() {\n  return <div>PILO</div>;\n}",
      scrollY: 0,
    },
  };
}

function isPersistableFreeformShape(_shape: TLShape) {
  return true;
}

function createPiloAssetId(prefix: string, index: number) {
  return createCustomRecordId(
    "asset",
    `pilo-${prefix}-${Date.now()}-${index}`,
  ) as TLAssetId;
}

function createInsertableShape(
  index: number,
  position: { x: number; y: number },
  request: Extract<PiloPlacementRequest, { type: PiloInsertableTool }>,
): {
  asset?: PiloMediaAsset;
  shape: TLCreateShapePartial<TLShape> & { id: TLShapeId };
} {
  const offset = index * 10;

  if (request.type === "image") {
    const width = 320;
    const height = 200;
    const assetId = createPiloAssetId("image", index);
    const asset: PiloMediaAsset = {
      id: assetId,
      typeName: "asset",
      type: "image",
      props: {
        w: width,
        h: height,
        name: "Canvas image",
        isAnimated: false,
        mimeType: request.url.match(/^data:([^;]+);/)?.[1] ?? null,
        src: request.url,
      },
      meta: {},
    };

    return {
      asset,
      shape: ({
        id: createShapeId(`pilo-image-${Date.now()}-${index}`),
        type: "image",
        x: position.x - width / 2 + offset,
        y: position.y - height / 2 + offset,
        meta: {
          piloAsset: asset,
        },
        props: {
          w: width,
          h: height,
          playing: true,
          url: "",
          assetId,
          crop: null,
          flipX: false,
          flipY: false,
          altText: "Canvas image",
        },
      } as unknown) as TLCreateShapePartial<TLShape> & { id: TLShapeId },
    };
  }

  if (request.type === "video") {
    const width = 360;
    const height = 220;
    const assetId = createPiloAssetId("video", index);
    const asset: PiloMediaAsset = {
      id: assetId,
      typeName: "asset",
      type: "video",
      props: {
        w: width,
        h: height,
        name: "Canvas video",
        isAnimated: true,
        mimeType: request.url.match(/^data:([^;]+);/)?.[1] ?? null,
        src: request.url,
      },
      meta: {},
    };

    return {
      asset,
      shape: ({
        id: createShapeId(`pilo-video-${Date.now()}-${index}`),
        type: "video",
        x: position.x - width / 2 + offset,
        y: position.y - height / 2 + offset,
        meta: {
          piloAsset: asset,
        },
        props: {
          w: width,
          h: height,
          time: 0,
          playing: false,
          autoplay: false,
          url: "",
          assetId,
          altText: "Canvas video",
        },
      } as unknown) as TLCreateShapePartial<TLShape> & { id: TLShapeId },
    };
  }

  if (request.type === "bookmark") {
    const width = 320;
    const height = 160;

    return {
      shape: {
        id: createShapeId(`pilo-bookmark-${Date.now()}-${index}`),
        type: "bookmark",
        x: position.x - width / 2 + offset,
        y: position.y - height / 2 + offset,
        props: {
          w: width,
          h: height,
          assetId: null,
          url: request.url,
        },
      } as TLCreateShapePartial<TLShape> & { id: TLShapeId },
    };
  }

  const width = 420;
  const height = 260;

  return {
    shape: {
      id: createShapeId(`pilo-embed-${Date.now()}-${index}`),
      type: "embed",
      x: position.x - width / 2 + offset,
      y: position.y - height / 2 + offset,
      props: {
        w: width,
        h: height,
        url: request.url,
      },
    } as TLCreateShapePartial<TLShape> & { id: TLShapeId },
  };
}

function toFreeformSnapshot(shape: TLShape): PiloCanvasFreeformShape {
  return JSON.parse(JSON.stringify(shape)) as PiloCanvasFreeformShape;
}

function sortFreeformShapesForCreate(shapes: PiloCanvasFreeformShape[]) {
  return [...shapes].sort((first, second) => {
    const firstParent =
      first.type === "frame" || first.type === "pilo-code-block";
    const secondParent =
      second.type === "frame" || second.type === "pilo-code-block";

    if (firstParent === secondParent) return 0;

    return firstParent ? -1 : 1;
  });
}

function CanvasStateReporter({
  onFreeformShapesChange,
  onViewChange,
}: {
  onFreeformShapesChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onViewChange: (viewSetting: CanvasViewSetting) => void;
}) {
  const editor = useEditor();
  const viewSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freeformSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const camera = useValue("pilo-camera-state", () => editor.getCamera(), [
    editor,
  ]);

  useEffect(() => {
    if (viewSyncTimerRef.current) {
      clearTimeout(viewSyncTimerRef.current);
    }

    const nextViewSetting = {
      zoom: camera.z,
      viewportX: camera.x,
      viewportY: camera.y,
    };

    viewSyncTimerRef.current = setTimeout(() => {
      viewSyncTimerRef.current = null;
      onViewChange(nextViewSetting);
    }, 140);

    return () => {
      if (viewSyncTimerRef.current) {
        clearTimeout(viewSyncTimerRef.current);
      }
    };
  }, [camera.x, camera.y, camera.z, onViewChange]);

  useEffect(() => {
    function readFreeformShapes() {
      return editor
        .getCurrentPageShapes()
        .filter(isPersistableFreeformShape)
        .map(toFreeformSnapshot);
    }

    function scheduleFreeformSync() {
      if (freeformSyncTimerRef.current) {
        clearTimeout(freeformSyncTimerRef.current);
      }

      freeformSyncTimerRef.current = setTimeout(() => {
        freeformSyncTimerRef.current = null;
        onFreeformShapesChange(readFreeformShapes());
      }, 220);
    }

    const removeListener = editor.store.listen(scheduleFreeformSync, {
      source: "all",
      scope: "document",
    });

    return () => {
      if (freeformSyncTimerRef.current) {
        clearTimeout(freeformSyncTimerRef.current);
      }
      removeListener();
    };
  }, [editor, onFreeformShapesChange]);

  return null;
}

function restorePiloShapeAssets(editor: Editor, shapes: PiloCanvasFreeformShape[]) {
  const assets = shapes
    .map((shape) => (shape as PiloShapeWithMediaAssetMeta).meta?.piloAsset)
    .filter((asset): asset is PiloMediaAsset => Boolean(asset));

  if (assets.length) {
    editor.createAssets(assets);
  }
}

export function PiloTldrawCanvas({
  board,
  freeformShapes,
  hydrationVersion,
  onReady,
  onFreeformShapesChange,
  onViewChange,
}: PiloTldrawCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const placementRequestRef = useRef<PiloPlacementRequest | null>(null);
  const createdLocalCardsRef = useRef(0);
  const freeformShapesRef = useRef(freeformShapes);
  const seedKey = board.id;

  useEffect(() => {
    freeformShapesRef.current = freeformShapes;
  }, [freeformShapes]);

  useEffect(() => {
    const editor = editorRef.current;
    const nextFreeformShapes = freeformShapesRef.current;

    if (!editor) return;

    const existingFreeformShapeIds = editor
      .getCurrentPageShapes()
      .filter(isPersistableFreeformShape)
      .map((shape) => shape.id as TLShapeId);

    if (existingFreeformShapeIds.length) {
      editor.deleteShapes(existingFreeformShapeIds);
    }

    if (nextFreeformShapes.length) {
      restorePiloShapeAssets(editor, nextFreeformShapes);
      editor.createShapes(sortFreeformShapesForCreate(nextFreeformShapes));
    }

    if (nextFreeformShapes.length) {
      editor.zoomToFit({ animation: { duration: 180 } });
    }
  }, [hydrationVersion, seedKey]);

  function mountEditor(editor: Editor) {
    editorRef.current = editor;
    editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
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

      return applyPiloSmartSnap(editor, prev, nextShape);
    });

    if (freeformShapes.length) {
      restorePiloShapeAssets(editor, freeformShapes);
      editor.createShapes(sortFreeformShapesForCreate(freeformShapes));
    }

    if (freeformShapes.length) {
      editor.zoomToFit({ animation: { duration: 180 } });
    }

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

        if (preset === "frame") {
          editor.setCurrentTool("frame");
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
    createdLocalCardsRef.current += 1;

    if (placementRequest.type === "sticky") {
      const shape = createStickyNoteShape(
        createdLocalCardsRef.current,
        point,
        placementRequest.color,
      );

      editor.createShapes([shape]);
      editor.select(shape.id as TLShapeId);
      return true;
    }

    if (placementRequest.type === "sticky-stack") {
      const startIndex = createdLocalCardsRef.current;
      const stackColors: PiloStickyNoteColor[] = placementRequest.color
        ? [
            placementRequest.color,
            placementRequest.color,
            placementRequest.color,
          ]
        : ["butter", "peach", "pink"];
      const shapes = stackColors.map((stackColor, stackIndex) =>
        createStickyNoteShape(startIndex + stackIndex, point, stackColor),
      );

      createdLocalCardsRef.current += shapes.length - 1;
      editor.createShapes(shapes);
      editor.select(shapes[shapes.length - 1].id as TLShapeId);
      return true;
    }

    if (placementRequest.type === "code") {
      const shape = createCodeBlockShape(createdLocalCardsRef.current, point);

      editor.createShapes([shape]);
      editor.select(shape.id as TLShapeId);
      return true;
    }

    const { asset, shape } = createInsertableShape(
      createdLocalCardsRef.current,
      point,
      placementRequest,
    );

    if (asset) {
      editor.createAssets([asset]);
    }

    editor.createShapes([shape]);
    editor.select(shape.id as TLShapeId);
    return true;
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

      return;
    }

    if (directShape && !isPiloFrameShape(directShape)) return;

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
      return;
    }

    editor.setCurrentTool("select");
    editor.select(frameShape.id);
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      className="pilo-tldraw-canvas"
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onWheelCapture={handleCanvasWheel}
    >
      <Tldraw
        hideUi
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        shapeUtils={shapeUtils}
        components={tldrawComponents}
        onMount={mountEditor}
      >
        <CanvasStateReporter
          onFreeformShapesChange={onFreeformShapesChange}
          onViewChange={onViewChange}
        />
        <SmartGuidesOverlay />
        <SelectedShapeStackingManager />
        <FrameSelectionToolbar />
      </Tldraw>
    </div>
  );
}
