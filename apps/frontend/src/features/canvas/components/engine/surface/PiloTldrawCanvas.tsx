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
  type TLShapePartial,
  useEditor,
} from "tldraw";
import { useValue } from "@tldraw/state-react";
import { useCanvasAgent } from "@/features/canvas/agent/use-canvas-agent";
import { CanvasWorkspaceLocationAdapter } from "@/features/canvas/canvas-workspace-location-adapter";
import { TldrawSurface } from "@/shared/tldraw";
import type { CanvasPresenceController } from "@/features/canvas/realtime/useCanvasPresence";
import { RemoteCursorOverlay } from "@/shared/canvas-realtime/RemoteCursorOverlay";
import { CanvasRemotePresenceProvider } from "@/features/canvas/realtime/CanvasRemotePresenceContext";
import type {
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
  CanvasPresenceViewport,
  CanvasShapePreviewEventPayload,
  CanvasShapePreviewPhase,
} from "@/shared/canvas-realtime/canvas-realtime-types";
import { PiloCanvasBackground } from "./PiloCanvasBackground";
import {
  CanvasAiChatOverlay,
  type CanvasAiChatAnchor,
} from "./CanvasAiChatOverlay";
import { CanvasAgentVisualOverlay } from "./CanvasAgentVisualOverlay";
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
  removeStaleSerializedArrowBindings,
  readSerializedArrowBindings,
  restoreSerializedArrowBindings,
  withSerializedArrowBindings,
  type PiloArrowBindingSnapshot,
} from "./pilo-canvas-arrow-bindings";
import type {
  PiloCanvasShapeDetailRequest,
  PiloCanvasFreeformShape,
  PiloCanvasLocalInteractionState,
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
import {
  PILO_CHILD_SHAPE_COUNT_META_KEY,
  PILO_FRAME_EXPANDED_SIZE_META_KEY,
  PILO_FRAME_COLLAPSED_META_KEY,
  getPiloFrameExpandedSize,
  getPiloChildShapeCount,
  isPiloFrameCollapsed,
} from "../../../utils/canvas-collapse";

export type { PiloCanvasFreeformShape } from "../types";
export type { PiloInsertableTool } from "../shapes/pilo-canvas-shape-factory";

type CanvasBoardDetail = {
  id: string;
  workspaceId: string;
  title: string;
  shapeCount: number;
};

export type PiloCanvasTool =
  | "select"
  | "note"
  | "draw"
  | "text"
  | "arrow"
  | "line"
  | "geo"
  | "frame"
  | "code";

export type PiloCanvasColor =
  | "default"
  | "black"
  | "red"
  | "yellow"
  | "green"
  | "blue"
  | "violet";

export type PiloDrawingPreset =
  | "pen"
  | "highlight"
  | "eraser"
  | "rectangle"
  | "circle"
  | "triangle";

export type PiloCanvasActions = {
  markUiEventAsHandled: (event: PointerEvent<HTMLElement>) => void;
  openCanvasAiChat: (anchor: CanvasAiChatAnchor) => void;
  selectTool: (tool: PiloCanvasTool) => void;
  selectDrawingPreset: (preset: PiloDrawingPreset) => void;
  setColor: (color: PiloCanvasColor) => void;
  createInsertableShape: (tool: PiloInsertableTool, url: string) => void;
  groupSelection: () => void;
  setSmartGuidesEnabled: (enabled: boolean) => void;
  createNote: () => void;
  createCodeBlock: () => void;
  clearSelection: () => void;
  deleteSelection: () => void;
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

export type PiloCanvasShapePatch = {
  deletedShapeIds: string[];
  upsertShapes: PiloCanvasFreeformShape[];
};

type PiloTldrawCanvasProps = {
  board: CanvasBoardDetail;
  cameraRestoreVersion: number;
  consumeShapePatch: () => PiloCanvasShapePatch;
  hydrationVersion: number;
  initialViewSetting: PiloCanvasViewSetting;
  freeformShapes: PiloCanvasFreeformShape[];
  onReady: (actions: PiloCanvasActions | null) => void;
  onFreeformShapesDraftChange: (shapes: PiloCanvasFreeformShape[]) => void;
  onFreeformShapesChange: (
    shapes: PiloCanvasFreeformShape[],
    explicitDeletedShapeIds?: string[],
  ) => void;
  onViewChange: (viewSetting: PiloCanvasViewSetting) => void;
  onFrameChildShapesUnload: (shapes: PiloCanvasFreeformShape[]) => void;
  onFrameChildrenRequest: (frameId: string) => void;
  getPreservedFreeformShapeSnapshots?: () => PiloCanvasFreeformShape[];
  isShapePatchProtected: (shapeId: string) => boolean;
  onViewportBoundsChange: (bounds: PiloCanvasViewportBounds) => void;
  onShapeDetailRequest: (request: PiloCanvasShapeDetailRequest) => void;
  onHistoryStateChange: (state: PiloCanvasHistoryState) => void;
  onLocalInteractionStateChange: (
    state: PiloCanvasLocalInteractionState,
  ) => void;
  presence?: CanvasPresenceController;
  onSnapStateChange: (state: PiloCanvasSnapState) => void;
  onOneShotToolCreated?: () => void;
  shapePatchVersion: number;
  canvasAgentEnabled?: boolean;
};

const tldrawComponents = {
  Background: PiloCanvasBackground,
};

const PILO_COLLAPSED_FRAME_SIZE = 144;
const CANVAS_AI_CHAT_HOLD_MS = 500;
const CANVAS_PENDING_PREVIEW_GROUP_TTL_MS = 30_000;
const CANVAS_PENDING_PREVIEW_HEARTBEAT_MS = 1_500;
const CANVAS_REMOTE_PREVIEW_DELETE_GRACE_MS = 8_000;
const CANVAS_SHAPE_PREVIEW_THROTTLE_MS = 60;
const CANVAS_PRESENCE_CURSOR_MIN_DISTANCE = 2;
const CANVAS_PRESENCE_CURSOR_THROTTLE_MS = 60;
const connectionTools = new Set<PiloCanvasTool>(["arrow", "line"]);
const PILO_FRAME_EXPANDED_FALLBACK_SIZE = {
  h: 180,
  w: 320,
};

const localInteractionStateIdle: PiloCanvasLocalInteractionState = {
  currentToolId: "select.idle",
  editingShapeId: null,
  focusedGroupId: null,
  isFocused: false,
  protectedShapeIds: [],
  selectedShapeIds: [],
};

type PendingRealtimePreviewGroup = {
  createdAt: number;
  expiresAt: number;
  id: string;
  shapeIds: Set<string>;
  snapshots: Map<string, PiloCanvasFreeformShape>;
};

type PendingShapePreviewPayload = {
  deletedShapeIds: string[];
  phase: CanvasShapePreviewPhase;
  shapes: Record<string, unknown>[];
};

function getRestorableToolId(toolId: string) {
  if (!toolId || toolId.startsWith("select.")) {
    return "select.idle";
  }

  return toolId;
}

function getProtectedLocalShapeIds(
  selectedShapeIds: TLShapeId[],
  editingShapeId: TLShapeId | null,
) {
  const protectedShapeIds = new Set<string>();

  if (editingShapeId) {
    protectedShapeIds.add(String(editingShapeId));
  }

  if (selectedShapeIds.length) {
    selectedShapeIds.forEach((shapeId) => {
      protectedShapeIds.add(String(shapeId));
    });
  }

  return Array.from(protectedShapeIds);
}

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

function getFreeformShapeId(shape: PiloCanvasFreeformShape | TLShape) {
  return typeof shape.id === "string" ? shape.id : null;
}

function cloneFreeformShape(shape: PiloCanvasFreeformShape) {
  return JSON.parse(JSON.stringify(shape)) as PiloCanvasFreeformShape;
}

function buildFreeformShapeMapFromShapes(shapes: PiloCanvasFreeformShape[]) {
  const shapeMap = new Map<string, PiloCanvasFreeformShape>();

  shapes.forEach((shape) => {
    const shapeId = getFreeformShapeId(shape);

    if (shapeId) {
      shapeMap.set(shapeId, shape);
    }
  });

  return shapeMap;
}

function hasGroupedFreeformShapes(shapes: PiloCanvasFreeformShape[]) {
  if (shapes.length < 2) return false;

  const shapeIds = new Set<string>(
    shapes.flatMap((shape) => {
      const shapeId = getFreeformShapeId(shape);

      return shapeId ? [shapeId] : [];
    }),
  );

  return shapes.some((shape) => {
    if (shape.type === "frame") return true;

    const parentId = typeof shape.parentId === "string" ? shape.parentId : null;

    return Boolean(parentId && shapeIds.has(parentId));
  });
}

function refreshPendingPreviewGroupSnapshots({
  groups,
  now,
  shapes,
}: {
  groups: Map<string, PendingRealtimePreviewGroup>;
  now: number;
  shapes: PiloCanvasFreeformShape[];
}) {
  const currentShapesById = buildFreeformShapeMapFromShapes(shapes);

  groups.forEach((group, groupId) => {
    if (group.expiresAt <= now) {
      groups.delete(groupId);
      return;
    }

    group.shapeIds.forEach((shapeId) => {
      const currentShape = currentShapesById.get(shapeId);

      if (currentShape) {
        group.snapshots.set(shapeId, cloneFreeformShape(currentShape));
      }
    });
  });

  return currentShapesById;
}

function acknowledgePendingPreviewGroupShapes(
  groups: Map<string, PendingRealtimePreviewGroup>,
  committedShapeIds: string[],
) {
  if (!groups.size || !committedShapeIds.length) return;

  const committedShapeIdSet = new Set(committedShapeIds);

  groups.forEach((group, groupId) => {
    committedShapeIdSet.forEach((shapeId) => {
      group.shapeIds.delete(shapeId);
      group.snapshots.delete(shapeId);
    });

    if (!group.shapeIds.size) {
      groups.delete(groupId);
    }
  });
}

function isShapeHiddenByCollapsedAncestor({
  currentShapesById,
  shape,
  snapshots,
}: {
  currentShapesById: Map<string, PiloCanvasFreeformShape>;
  shape: PiloCanvasFreeformShape;
  snapshots: Map<string, PiloCanvasFreeformShape>;
}) {
  let parentId = typeof shape.parentId === "string" ? shape.parentId : null;
  const visitedParentIds = new Set<string>();

  while (parentId) {
    if (visitedParentIds.has(parentId)) return false;
    visitedParentIds.add(parentId);

    const parentShape = currentShapesById.get(parentId) ?? snapshots.get(parentId);

    if (!parentShape) return false;
    if (isPiloFrameCollapsed(parentShape)) return true;

    parentId =
      typeof parentShape.parentId === "string" ? parentShape.parentId : null;
  }

  return false;
}

function collectPendingPreviewGroupShapeIds(
  groups: Map<string, PendingRealtimePreviewGroup>,
) {
  const shapeIds = new Set<string>();

  groups.forEach((group) => {
    group.shapeIds.forEach((shapeId) => shapeIds.add(shapeId));
  });

  return shapeIds;
}

function collectPendingPreviewGroupShapes({
  currentShapesById,
  groups,
}: {
  currentShapesById: Map<string, PiloCanvasFreeformShape>;
  groups: Map<string, PendingRealtimePreviewGroup>;
}) {
  const previewShapesById = new Map<string, PiloCanvasFreeformShape>();

  groups.forEach((group) => {
    group.shapeIds.forEach((shapeId) => {
      const currentShape = currentShapesById.get(shapeId);
      const snapshot = currentShape ?? group.snapshots.get(shapeId);

      if (!snapshot) return;
      if (
        !currentShape &&
        isShapeHiddenByCollapsedAncestor({
          currentShapesById,
          shape: snapshot,
          snapshots: group.snapshots,
        })
      ) {
        return;
      }

      previewShapesById.set(shapeId, snapshot);
    });
  });

  return Array.from(previewShapesById.values());
}

function serializeFreeformShape(shape: PiloCanvasFreeformShape) {
  return JSON.stringify(shape);
}

function hasFreeformShapeChanged(
  editor: Editor,
  currentShape: TLShape,
  nextShape: PiloCanvasFreeformShape,
) {
  return (
    serializeFreeformShape(withSerializedArrowBindings(editor, currentShape)) !==
    serializeFreeformShape(nextShape)
  );
}

function restoreFreeformShapeBindings(
  editor: Editor,
  shapes: PiloCanvasFreeformShape[],
  pendingArrowBindingsRef: MutableRefObject<PiloArrowBindingSnapshot[]>,
) {
  const bindingsToRestore = uniquePendingArrowBindings([
    ...pendingArrowBindingsRef.current,
    ...collectSerializedArrowBindings(shapes),
  ]);

  removeStaleSerializedArrowBindings(editor, shapes);

  if (!bindingsToRestore.length) return;

  const result = restoreSerializedArrowBindings(editor, bindingsToRestore);
  pendingArrowBindingsRef.current = uniquePendingArrowBindings(result.pending);
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

  restoreFreeformShapeBindings(editor, shapes, pendingArrowBindingsRef);
}

function hydrateFreeformShapes(
  editor: Editor,
  shapes: PiloCanvasFreeformShape[],
  pendingArrowBindingsRef: MutableRefObject<PiloArrowBindingSnapshot[]>,
  piloDefaultArrowKindHydrationGuardRef: MutableRefObject<boolean>,
) {
  editor.store.mergeRemoteChanges(() => {
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
  });
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
  { preserveLocalState = false }: { preserveLocalState?: boolean } = {},
) {
  const selectedShapeIds = preserveLocalState ? editor.getSelectedShapeIds() : [];
  const editingShapeId = preserveLocalState ? editor.getEditingShapeId() : null;
  const currentPageState = preserveLocalState
    ? editor.getCurrentPageState()
    : null;
  const focusedGroupId = currentPageState?.focusedGroupId ?? null;
  const currentToolId = preserveLocalState ? editor.getCurrentToolId() : null;
  const isFocused = preserveLocalState ? editor.getIsFocused() : false;

  editor.store.mergeRemoteChanges(() => {
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

        if (preserveLocalState) {
          const nextSelectedShapeIds = selectedShapeIds.filter((shapeId) =>
            editor.getShape(shapeId),
          );

          if (nextSelectedShapeIds.length) {
            editor.setSelectedShapes(nextSelectedShapeIds);
          }

          if (focusedGroupId && editor.getShape(focusedGroupId)) {
            editor.setFocusedGroup(focusedGroupId);
          }

          if (editingShapeId && editor.getShape(editingShapeId)) {
            editor.setEditingShape(editingShapeId);
          }

          if (currentToolId) {
            editor.setCurrentTool(getRestorableToolId(currentToolId));
          }
        }
      },
      { history: "ignore" },
    );
  });

  if (isFocused) {
    editor.focus({ focusContainer: false });
  }
}

function syncFreeformShapesIncrementally(
  editor: Editor,
  shapes: PiloCanvasFreeformShape[],
  pendingArrowBindingsRef: MutableRefObject<PiloArrowBindingSnapshot[]>,
  piloDefaultArrowKindHydrationGuardRef: MutableRefObject<boolean>,
  getPreservedFreeformShapeSnapshots?: () => PiloCanvasFreeformShape[],
) {
  editor.store.mergeRemoteChanges(() => {
    editor.run(
      () => {
        const incomingShapeMap = new Map<string, PiloCanvasFreeformShape>();
        const preservedShapeMap = buildFreeformShapeMapFromShapes(
          getPreservedFreeformShapeSnapshots?.() ?? [],
        );
        const currentShapeMap = new Map<string, TLShape>();
        const shapeIdsToDelete: TLShapeId[] = [];
        const shapesToCreate: PiloCanvasFreeformShape[] = [];
        const shapesToUpdate: PiloCanvasFreeformShape[] = [];
        const changedShapesForBindingRestore: PiloCanvasFreeformShape[] = [];

        shapes.forEach((shape) => {
          const shapeId = getFreeformShapeId(shape);

          if (shapeId) {
            incomingShapeMap.set(shapeId, shape);
          }
        });

        editor.getCurrentPageShapes().forEach((shape) => {
          currentShapeMap.set(String(shape.id), shape);

          if (!incomingShapeMap.has(String(shape.id))) {
            if (
              shouldPreserveMissingFrameChildShape({
                incomingShapeMap,
                preservedShapeMap,
                shapeId: String(shape.id),
              })
            ) {
              return;
            }

            shapeIdsToDelete.push(shape.id as TLShapeId);
          }
        });

        shapes.forEach((shape) => {
          const shapeId = getFreeformShapeId(shape);
          const currentShape = shapeId ? currentShapeMap.get(shapeId) : null;

          if (!currentShape) {
            shapesToCreate.push(shape);
            changedShapesForBindingRestore.push(shape);
            return;
          }

          if (currentShape.type !== shape.type) {
            shapeIdsToDelete.push(currentShape.id as TLShapeId);
            shapesToCreate.push(shape);
            changedShapesForBindingRestore.push(shape);
            return;
          }

          if (hasFreeformShapeChanged(editor, currentShape, shape)) {
            shapesToUpdate.push(shape as TLShapePartial<TLShape>);
            changedShapesForBindingRestore.push(shape);
          }
        });

        if (shapeIdsToDelete.length) {
          editor.deleteShapes(Array.from(new Set(shapeIdsToDelete)));
        }

        if (shapesToCreate.length || shapesToUpdate.length) {
          restorePiloShapeAssets(editor, [...shapesToCreate, ...shapesToUpdate]);
        }

        if (shapesToCreate.length) {
          piloDefaultArrowKindHydrationGuardRef.current = true;
          try {
            editor.createShapes(sortFreeformShapesForCreate(shapesToCreate));
          } finally {
            piloDefaultArrowKindHydrationGuardRef.current = false;
          }
        }

        if (shapesToUpdate.length) {
          editor.updateShapes(shapesToUpdate as TLShapePartial<TLShape>[]);
        }

        if (changedShapesForBindingRestore.length) {
          restoreFreeformShapeBindings(
            editor,
            changedShapesForBindingRestore,
            pendingArrowBindingsRef,
          );
        } else if (pendingArrowBindingsRef.current.length) {
          restoreFreeformShapeBindings(editor, [], pendingArrowBindingsRef);
        }
      },
      { history: "ignore" },
    );
  });
}

function applyFreeformShapePatchIncrementally(
  editor: Editor,
  patch: PiloCanvasShapePatch,
  pendingArrowBindingsRef: MutableRefObject<PiloArrowBindingSnapshot[]>,
  piloDefaultArrowKindHydrationGuardRef: MutableRefObject<boolean>,
) {
  const deletedShapeIdSet = new Set(patch.deletedShapeIds);
  const shapesToCreate: PiloCanvasFreeformShape[] = [];
  const shapesToUpdate: PiloCanvasFreeformShape[] = [];
  const shapeIdsToDelete = new Set<TLShapeId>();
  const changedShapesForBindingRestore: PiloCanvasFreeformShape[] = [];

  patch.deletedShapeIds.forEach((shapeId) => {
    const currentShape = editor.getShape(shapeId as TLShapeId);

    if (currentShape) {
      shapeIdsToDelete.add(currentShape.id as TLShapeId);
    }
  });

  patch.upsertShapes.forEach((shape) => {
    const shapeId = getFreeformShapeId(shape);

    if (!shapeId || deletedShapeIdSet.has(shapeId)) return;

    const currentShape = editor.getShape(shapeId as TLShapeId);

    if (!currentShape) {
      shapesToCreate.push(shape);
      changedShapesForBindingRestore.push(shape);
      return;
    }

    if (currentShape.type !== shape.type) {
      shapeIdsToDelete.add(currentShape.id as TLShapeId);
      shapesToCreate.push(shape);
      changedShapesForBindingRestore.push(shape);
      return;
    }

    if (hasFreeformShapeChanged(editor, currentShape, shape)) {
      shapesToUpdate.push(shape);
      changedShapesForBindingRestore.push(shape);
    }
  });

  if (
    !shapeIdsToDelete.size &&
    !shapesToCreate.length &&
    !shapesToUpdate.length
  ) {
    return;
  }

  editor.store.mergeRemoteChanges(() => {
    editor.run(
      () => {
        if (shapeIdsToDelete.size) {
          editor.deleteShapes([...shapeIdsToDelete]);
        }

        if (shapesToCreate.length || shapesToUpdate.length) {
          restorePiloShapeAssets(editor, [...shapesToCreate, ...shapesToUpdate]);
        }

        if (shapesToCreate.length) {
          piloDefaultArrowKindHydrationGuardRef.current = true;
          try {
            editor.createShapes(sortFreeformShapesForCreate(shapesToCreate));
          } finally {
            piloDefaultArrowKindHydrationGuardRef.current = false;
          }
        }

        if (shapesToUpdate.length) {
          editor.updateShapes(shapesToUpdate as TLShapePartial<TLShape>[]);
        }

        if (changedShapesForBindingRestore.length) {
          restoreFreeformShapeBindings(
            editor,
            changedShapesForBindingRestore,
            pendingArrowBindingsRef,
          );
        }
      },
      { history: "ignore" },
    );
  });
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

function isPointerInsideTrashDropZone(event: globalThis.PointerEvent) {
  const target = document.elementFromPoint(event.clientX, event.clientY);

  return Boolean(target?.closest(".canvas-trash-drop-zone"));
}

function updateTrashDropZoneAttraction(
  editor: Editor,
  event: globalThis.PointerEvent,
) {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const trashDropZone = target?.closest(".canvas-trash-drop-zone");

  const shouldAttract =
    Boolean(trashDropZone) && editor.getSelectedShapeIds().length > 0;

  document
    .querySelectorAll(".canvas-trash-drop-zone")
    .forEach((currentTrashDropZone) =>
      currentTrashDropZone.classList.toggle(
        "is-attracting",
        shouldAttract && currentTrashDropZone === trashDropZone,
      ),
    );
}

function clearTrashDropZoneAttraction() {
  document
    .querySelectorAll(".canvas-trash-drop-zone.is-attracting")
    .forEach((trashDropZone) =>
      trashDropZone.classList.remove("is-attracting"),
    );
}

function isPiloErasableShape(shape: TLShape | undefined) {
  return Boolean(shape && (shape.type === "draw" || shape.type === "highlight"));
}

function isCanvasEditableShortcutTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable=\"true\"], .pilo-code-mirror",
      ),
    )
  );
}

function getShapePreviewPhase(
  currentToolId: string,
  selectedShapeIds: string[],
): CanvasShapePreviewPhase | null {
  if (!selectedShapeIds.length) return null;
  if (currentToolId.includes("resize")) return "resize";
  if (currentToolId.includes("translate")) return "move";

  return null;
}

function getDeletedPreviewShapeIds({
  nextShapes,
  previewShapeIds,
  previousShapes,
}: {
  nextShapes: PiloCanvasFreeformShape[];
  previewShapeIds: Set<string>;
  previousShapes: PiloCanvasFreeformShape[];
}) {
  if (!previewShapeIds.size) return [];

  const previousShapeIds = new Set<string>(
    previousShapes.flatMap((shape) => {
      const shapeId = getFreeformShapeId(shape);

      return shapeId ? [String(shapeId)] : [];
    }),
  );
  const nextShapeIds = new Set<string>(
    nextShapes.flatMap((shape) => {
      const shapeId = getFreeformShapeId(shape);

      return shapeId ? [String(shapeId)] : [];
    }),
  );

  return Array.from(previewShapeIds).filter(
    (shapeId) => previousShapeIds.has(shapeId) && !nextShapeIds.has(shapeId),
  );
}

function getCreatedFreeformShapeIds({
  nextShapes,
  previousShapes,
}: {
  nextShapes: PiloCanvasFreeformShape[];
  previousShapes: PiloCanvasFreeformShape[];
}) {
  const previousShapeIds = new Set<string>(
    previousShapes.flatMap((shape) => {
      const shapeId = getFreeformShapeId(shape);

      return shapeId ? [String(shapeId)] : [];
    }),
  );

  return nextShapes.flatMap((shape) => {
    const shapeId = getFreeformShapeId(shape);

    return shapeId && !previousShapeIds.has(String(shapeId))
      ? [String(shapeId)]
      : [];
  });
}

function shouldPreserveMissingFrameChildShape({
  incomingShapeMap,
  preservedShapeMap,
  shapeId,
}: {
  incomingShapeMap: Map<string, PiloCanvasFreeformShape>;
  preservedShapeMap: Map<string, PiloCanvasFreeformShape>;
  shapeId: string;
}) {
  const preservedShape = preservedShapeMap.get(shapeId);
  const parentId =
    preservedShape && typeof preservedShape.parentId === "string"
      ? preservedShape.parentId
      : null;

  if (!preservedShape || !parentId?.startsWith("shape:")) return false;
  if (!incomingShapeMap.has(parentId) && !preservedShapeMap.has(parentId)) {
    return false;
  }

  return !isShapeHiddenByCollapsedAncestor({
    currentShapesById: incomingShapeMap,
    shape: preservedShape,
    snapshots: preservedShapeMap,
  });
}

function deleteSelectedShapes(editor: Editor) {
  const selectedShapeIds = editor.getSelectedShapeIds();

  if (!selectedShapeIds.length) return false;

  editor.deleteShapes(selectedShapeIds);
  return true;
}

function getArrowAtPoint(editor: Editor, pagePoint: { x: number; y: number }) {
  const hitMargin = 8 / editor.getZoomLevel();

  return editor
    .getShapesAtPoint(pagePoint, {
      hitInside: true,
      margin: hitMargin,
    })
    .find((shape) => shape.type === "arrow");
}

export function PiloTldrawCanvas({
  board,
  cameraRestoreVersion,
  consumeShapePatch,
  freeformShapes,
  hydrationVersion,
  initialViewSetting,
  onReady,
  onFreeformShapesDraftChange,
  onFreeformShapesChange,
  onViewChange,
  onFrameChildShapesUnload,
  onFrameChildrenRequest,
  getPreservedFreeformShapeSnapshots,
  isShapePatchProtected,
  onViewportBoundsChange,
  onShapeDetailRequest,
  onHistoryStateChange,
  onLocalInteractionStateChange,
  presence,
  onSnapStateChange,
  onOneShotToolCreated,
  shapePatchVersion,
  canvasAgentEnabled = false,
}: PiloTldrawCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const [canvasEditor, setCanvasEditor] = useState<Editor | null>(null);
  const placementRequestRef = useRef<PiloPlacementRequest | null>(null);
  const returnToSelectAfterPlacementRef = useRef(false);
  const onOneShotToolCreatedRef = useRef(onOneShotToolCreated);
  const canvasAiChatPointerRef = useRef<CanvasAiChatAnchor | null>(null);
  const canvasAiChatHoldFrameRef = useRef<number | null>(null);
  const canvasAiChatHoldStartedAtRef = useRef<number | null>(null);
  const canvasAiChatHoldPositionRef = useRef<CanvasAiChatAnchor | null>(null);
  const pendingArrowBindingsRef = useRef<PiloArrowBindingSnapshot[]>([]);
  const piloDefaultArrowKindHydrationGuardRef = useRef(false);
  const piloEraserActiveRef = useRef(false);
  const piloEraserPointerIdRef = useRef<number | null>(null);
  const createdLocalCardsRef = useRef(0);
  const freeformShapesRef = useRef(freeformShapes);
  const localPreviewShapeIdsRef = useRef<string[]>([]);
  const localPreviewPhaseRef = useRef<CanvasShapePreviewPhase | null>(null);
  const pendingShapePreviewPayloadRef =
    useRef<PendingShapePreviewPayload | null>(null);
  const shapePreviewSendTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastShapePreviewSentAtRef = useRef(0);
  const pendingRealtimePreviewGroupsRef = useRef(
    new Map<string, PendingRealtimePreviewGroup>(),
  );
  const remotePreviewOriginalShapesRef = useRef(
    new Map<string, PiloCanvasFreeformShape>(),
  );
  const remotePreviewShapeIdsRef = useRef(new Set<string>());
  const canvasWheelCleanupRef = useRef<(() => void) | null>(null);
  const lastHydratedSeedKeyRef = useRef<string | null>(null);
  const frameChildrenRequestTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialViewSettingRef = useRef(initialViewSetting);
  const seedKey = board.id;
  const [canvasAiChatAnchor, setCanvasAiChatAnchor] =
    useState<CanvasAiChatAnchor | null>(null);
  const [canvasAiChatHoldProgress, setCanvasAiChatHoldProgress] = useState<
    (CanvasAiChatAnchor & { progress: number }) | null
  >(null);
  const [isPiloEraserActive, setIsPiloEraserActive] = useState(false);
  const isCanvasAiChatVisible = Boolean(canvasAiChatAnchor || canvasAiChatHoldProgress);
  const handleCanvasAgentApplied = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const bounds = editor.getViewportPageBounds();
    onViewportBoundsChange({
      x: bounds.x,
      y: bounds.y,
      width: bounds.w,
      height: bounds.h,
      zoom: editor.getCamera().z,
    });
  }, [onViewportBoundsChange]);
  const canvasAgent = useCanvasAgent({
    canvasId: board.id,
    editor: canvasEditor,
    enabled: canvasAgentEnabled,
    onApplied: handleCanvasAgentApplied,
    workspaceId: board.workspaceId,
  });
  const scheduleShapePreviewSend = useCallback(
    (payload: PendingShapePreviewPayload) => {
      if (!presence?.enabled) return;

      pendingShapePreviewPayloadRef.current = payload;

      if (shapePreviewSendTimerRef.current) {
        return;
      }

      const elapsed = Date.now() - lastShapePreviewSentAtRef.current;
      const delay = Math.max(0, CANVAS_SHAPE_PREVIEW_THROTTLE_MS - elapsed);

      const flushPreview = () => {
        shapePreviewSendTimerRef.current = null;
        const nextPayload = pendingShapePreviewPayloadRef.current;

        pendingShapePreviewPayloadRef.current = null;
        if (!nextPayload) return;

        presence.sendShapePreview(
          nextPayload.shapes,
          nextPayload.phase,
          nextPayload.deletedShapeIds,
        );
        lastShapePreviewSentAtRef.current = Date.now();
      };

      if (delay === 0) {
        flushPreview();
        return;
      }

      shapePreviewSendTimerRef.current = setTimeout(flushPreview, delay);
    },
    [presence?.enabled, presence?.sendShapePreview],
  );

  useEffect(() => {
    onOneShotToolCreatedRef.current = onOneShotToolCreated;
  }, [onOneShotToolCreated]);

  useEffect(() => {
    freeformShapesRef.current = freeformShapes;
  }, [freeformShapes]);

  useEffect(() => {
    const committedPatch = presence?.lastCommittedShapePatch;

    if (!committedPatch) return;

    acknowledgePendingPreviewGroupShapes(
      pendingRealtimePreviewGroupsRef.current,
      committedPatch.shapeIds,
    );
  }, [presence?.lastCommittedShapePatch]);

  const resolveRealtimePreviewSnapshot = useCallback(
    (_shape: TLShape, snapshot: PiloCanvasFreeformShape) => {
      const shapeId = getFreeformShapeId(snapshot);

      if (!shapeId || !remotePreviewShapeIdsRef.current.has(shapeId)) {
        return snapshot;
      }

      return remotePreviewOriginalShapesRef.current.get(shapeId) ?? null;
    },
    [],
  );

  const registerPendingRealtimePreviewGroup = useCallback(
    (shapes: PiloCanvasFreeformShape[], reason: string) => {
      const groupShapes = shapes.filter((shape) => getFreeformShapeId(shape));

      if (!groupShapes.length) return;

      const shapeIds = new Set(
        groupShapes.flatMap((shape) => {
          const shapeId = getFreeformShapeId(shape);

          return shapeId ? [shapeId] : [];
        }),
      );
      const pendingGroups = pendingRealtimePreviewGroupsRef.current;
      const existingGroup = Array.from(pendingGroups.values()).find((group) =>
        Array.from(shapeIds).every((shapeId) => group.shapeIds.has(shapeId)),
      );
      const now = Date.now();
      const snapshots = new Map<string, PiloCanvasFreeformShape>();

      groupShapes.forEach((shape) => {
        const shapeId = getFreeformShapeId(shape);

        if (shapeId) {
          snapshots.set(shapeId, cloneFreeformShape(shape));
        }
      });

      if (existingGroup) {
        snapshots.forEach((snapshot, shapeId) => {
          existingGroup.snapshots.set(shapeId, snapshot);
        });
        existingGroup.expiresAt = Math.max(
          existingGroup.expiresAt,
          now + CANVAS_PENDING_PREVIEW_GROUP_TTL_MS,
        );
        return;
      }

      pendingGroups.set(`${reason}:${now}:${pendingGroups.size}`, {
        createdAt: now,
        expiresAt: now + CANVAS_PENDING_PREVIEW_GROUP_TTL_MS,
        id: `${reason}:${now}:${pendingGroups.size}`,
        shapeIds,
        snapshots,
      });
    },
    [],
  );

  const handleRealtimePreviewDraftChange = useCallback(
    (shapes: PiloCanvasFreeformShape[]) => {
      const previousShapes = freeformShapesRef.current;
      const createdShapeIds = getCreatedFreeformShapeIds({
        nextShapes: shapes,
        previousShapes,
      });
      const createdShapeIdSet = new Set(createdShapeIds);
      const createdShapes = shapes.filter((shape) => {
        const shapeId = getFreeformShapeId(shape);

        return shapeId ? createdShapeIdSet.has(shapeId) : false;
      });

      if (hasGroupedFreeformShapes(createdShapes)) {
        registerPendingRealtimePreviewGroup(createdShapes, "created-group");
      }

      const currentShapesById = refreshPendingPreviewGroupSnapshots({
        groups: pendingRealtimePreviewGroupsRef.current,
        now: Date.now(),
        shapes,
      });
      const pendingPreviewShapeIds = collectPendingPreviewGroupShapeIds(
        pendingRealtimePreviewGroupsRef.current,
      );
      const previewShapeIds = new Set([
        ...localPreviewShapeIdsRef.current,
        ...createdShapeIds,
        ...pendingPreviewShapeIds,
      ]);
      const phase = localPreviewPhaseRef.current;
      const deletedShapeIds = getDeletedPreviewShapeIds({
        nextShapes: shapes,
        previewShapeIds,
        previousShapes,
      });

      if (!presence?.enabled || !previewShapeIds.size) {
        return;
      }

      const previewShapesById = new Map<string, PiloCanvasFreeformShape>();

      shapes.forEach((shape) => {
        const shapeId = getFreeformShapeId(shape);

        if (shapeId && previewShapeIds.has(shapeId)) {
          previewShapesById.set(shapeId, shape);
        }
      });
      collectPendingPreviewGroupShapes({
        currentShapesById,
        groups: pendingRealtimePreviewGroupsRef.current,
      }).forEach((shape) => {
        const shapeId = getFreeformShapeId(shape);

        if (shapeId) {
          previewShapesById.set(shapeId, shape);
        }
      });
      const previewShapes = Array.from(previewShapesById.values());

      if (!previewShapes.length && !deletedShapeIds.length) return;

      scheduleShapePreviewSend({
        deletedShapeIds,
        phase: deletedShapeIds.length ? "delete" : (phase ?? "unknown"),
        shapes: previewShapes as unknown as Record<string, unknown>[],
      });
    },
    [
      presence?.enabled,
      registerPendingRealtimePreviewGroup,
      scheduleShapePreviewSend,
    ],
  );

  const handleLocalInteractionChange = useCallback(
    (state: PiloCanvasLocalInteractionState) => {
      const nextShapeIds = Array.from(
        new Set(state.protectedShapeIds.filter(Boolean)),
      );
      const nextPreviewPhase = getShapePreviewPhase(
        state.currentToolId,
        state.selectedShapeIds,
      );

      localPreviewShapeIdsRef.current = nextShapeIds;
      localPreviewPhaseRef.current = nextPreviewPhase;

      onLocalInteractionStateChange(state);
    },
    [onLocalInteractionStateChange],
  );
  const handleFreeformShapesDraftChange = useCallback(
    (shapes: PiloCanvasFreeformShape[]) => {
      onFreeformShapesDraftChange(shapes);
      handleRealtimePreviewDraftChange(shapes);
    },
    [handleRealtimePreviewDraftChange, onFreeformShapesDraftChange],
  );

  useEffect(() => {
    if (!presence?.enabled) return;

    const heartbeatTimer = window.setInterval(() => {
      if (!pendingRealtimePreviewGroupsRef.current.size) return;

      const editor = editorRef.current;

      if (!editor) return;

      const shapes = editor
        .getCurrentPageShapes()
        .map((shape) => withSerializedArrowBindings(editor, shape));

      handleRealtimePreviewDraftChange(shapes);
    }, CANVAS_PENDING_PREVIEW_HEARTBEAT_MS);

    return () => window.clearInterval(heartbeatTimer);
  }, [handleRealtimePreviewDraftChange, presence?.enabled]);

  useEffect(() => {
    initialViewSettingRef.current = initialViewSetting;
  }, [initialViewSetting]);

  useEffect(
    () => () => {
      if (canvasAiChatHoldFrameRef.current !== null) {
        window.cancelAnimationFrame(canvasAiChatHoldFrameRef.current);
      }

      if (frameChildrenRequestTimerRef.current) {
        clearTimeout(frameChildrenRequestTimerRef.current);
        frameChildrenRequestTimerRef.current = null;
      }

      if (shapePreviewSendTimerRef.current) {
        clearTimeout(shapePreviewSendTimerRef.current);
        shapePreviewSendTimerRef.current = null;
      }
      pendingShapePreviewPayloadRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) return;

    const shouldPreserveLocalState =
      lastHydratedSeedKeyRef.current === seedKey;

    if (shouldPreserveLocalState) {
      syncFreeformShapesIncrementally(
        editor,
        freeformShapesRef.current,
        pendingArrowBindingsRef,
        piloDefaultArrowKindHydrationGuardRef,
        getPreservedFreeformShapeSnapshots,
      );
    } else {
      resetFreeformShapes(
        editor,
        freeformShapesRef.current,
        pendingArrowBindingsRef,
        piloDefaultArrowKindHydrationGuardRef,
      );
    }

    lastHydratedSeedKeyRef.current = seedKey;
  }, [getPreservedFreeformShapeSnapshots, hydrationVersion, seedKey]);

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) return;

    applyFreeformShapePatchIncrementally(
      editor,
      consumeShapePatch(),
      pendingArrowBindingsRef,
      piloDefaultArrowKindHydrationGuardRef,
    );
  }, [consumeShapePatch, shapePatchVersion]);

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) return;

    applyViewSetting(editor, initialViewSettingRef.current);
  }, [cameraRestoreVersion, seedKey]);

  function deactivatePiloEraser(editor = editorRef.current) {
    piloEraserActiveRef.current = false;
    piloEraserPointerIdRef.current = null;
    setIsPiloEraserActive(false);

    if (editor?.getCurrentToolId() === "eraser") {
      editor.setCurrentTool("select.idle");
    }
  }

  function activatePiloEraser(editor: Editor) {
    placementRequestRef.current = null;
    returnToSelectAfterPlacementRef.current = false;
    piloEraserActiveRef.current = true;
    piloEraserPointerIdRef.current = null;
    setIsPiloEraserActive(true);
    editor.cancel();
    editor.updateInstanceState({ isToolLocked: false });
    editor.setCurrentTool("select.idle");
  }

  function erasePiloDrawShapeAtScreenPoint(
    editor: Editor,
    event: Pick<globalThis.PointerEvent, "clientX" | "clientY">,
  ) {
    const pagePoint = editor.screenToPage({
      x: event.clientX,
      y: event.clientY,
    });
    const hitMargin = editor.options.hitTestMargin / editor.getZoomLevel();
    const hitErasableShapes = editor
      .getShapesAtPoint(pagePoint, {
        hitInside: false,
        margin: hitMargin,
      })
      .filter(isPiloErasableShape);
    const erasableShapeIds = hitErasableShapes.map(
      (shape) => shape.id as TLShapeId,
    );

    if (!erasableShapeIds.length) return false;

    editor.deleteShapes(Array.from(new Set(erasableShapeIds)));
    return true;
  }

  function shouldUsePiloEraser(editor: Editor) {
    return (
      piloEraserActiveRef.current || editor.getCurrentToolId() === "eraser"
    );
  }

  function stopPiloEraserPointerEvent(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
  }

  function handlePiloEraserPointerDown(
    event: PointerEvent<HTMLDivElement>,
    editor: Editor,
  ) {
    if (event.button !== 0 || !shouldUsePiloEraser(editor)) return false;

    piloEraserActiveRef.current = true;
    piloEraserPointerIdRef.current = event.pointerId;
    editor.setCurrentTool("select.idle");
    editor.markHistoryStoppingPoint("pilo eraser begin");
    erasePiloDrawShapeAtScreenPoint(editor, event.nativeEvent);
    stopPiloEraserPointerEvent(event);
    return true;
  }

  function handlePiloEraserPointerMove(event: PointerEvent<HTMLDivElement>) {
    const editor = editorRef.current;

    if (
      !editor ||
      piloEraserPointerIdRef.current === null ||
      piloEraserPointerIdRef.current !== event.pointerId
    ) {
      return false;
    }

    erasePiloDrawShapeAtScreenPoint(editor, event.nativeEvent);
    stopPiloEraserPointerEvent(event);
    return true;
  }

  function handlePiloEraserPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const editor = editorRef.current;

    if (
      !editor ||
      piloEraserPointerIdRef.current === null ||
      piloEraserPointerIdRef.current !== event.pointerId
    ) {
      return false;
    }

    piloEraserPointerIdRef.current = null;
    editor.markHistoryStoppingPoint("pilo eraser end");
    stopPiloEraserPointerEvent(event);
    return true;
  }

  useEffect(() => {
    function shouldIgnoreCanvasAiChatShortcut(event: KeyboardEvent) {
      return (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "c" ||
        (event.target instanceof Element &&
          event.target.closest(
            "input, textarea, select, [contenteditable=\"true\"], .pilo-code-mirror",
          ))
      );
    }

    function startCanvasAiChatWithShortcut(event: KeyboardEvent) {
      if (
        event.repeat ||
        shouldIgnoreCanvasAiChatShortcut(event)
      ) {
        return;
      }

      event.preventDefault();
      startCanvasAiChatHold(
        canvasAiChatPointerRef.current ?? {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        },
      );
    }

    function cancelCanvasAiChatWithShortcut(event: KeyboardEvent) {
      if (shouldIgnoreCanvasAiChatShortcut(event)) return;

      event.preventDefault();
      cancelCanvasAiChatHold();
    }

    window.addEventListener("keydown", startCanvasAiChatWithShortcut, true);
    window.addEventListener("keyup", cancelCanvasAiChatWithShortcut, true);
    return () => {
      window.removeEventListener("keydown", startCanvasAiChatWithShortcut, true);
      window.removeEventListener("keyup", cancelCanvasAiChatWithShortcut, true);
    };
  }, []);

  useEffect(() => {
    function shouldIgnorePiloEraserShortcut(event: KeyboardEvent) {
      const editor = editorRef.current;

      return (
        !editor ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "e" ||
        isCanvasEditableShortcutTarget(event.target) ||
        !editor.getIsFocused()
      );
    }

    function activatePiloEraserWithShortcut(event: KeyboardEvent) {
      if (event.repeat || shouldIgnorePiloEraserShortcut(event)) return;

      const editor = editorRef.current;

      if (!editor) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      activatePiloEraser(editor);
    }

    window.addEventListener("keydown", activatePiloEraserWithShortcut, true);
    return () => {
      window.removeEventListener(
        "keydown",
        activatePiloEraserWithShortcut,
        true,
      );
    };
  }, []);

  useEffect(() => {
    function cancelPiloEraserWithEscape(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.key !== "Escape" ||
        isCanvasEditableShortcutTarget(event.target) ||
        !piloEraserActiveRef.current
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      deactivatePiloEraser();
    }

    window.addEventListener("keydown", cancelPiloEraserWithEscape, true);
    return () => {
      window.removeEventListener("keydown", cancelPiloEraserWithEscape, true);
    };
  }, []);

  useEffect(() => {
    if (!isCanvasAiChatVisible) return undefined;

    function closeCanvasAiChatWithEscape(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      cancelCanvasAiChatHold();
      setCanvasAiChatAnchor(null);
    }

    window.addEventListener("keydown", closeCanvasAiChatWithEscape, true);
    return () => {
      window.removeEventListener("keydown", closeCanvasAiChatWithEscape, true);
    };
  }, [isCanvasAiChatVisible]);

  function mountEditor(editor: Editor) {
    editorRef.current = editor;
    setCanvasEditor(editor);
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
      openCanvasAiChat(anchor) {
        deactivatePiloEraser(editor);
        placementRequestRef.current = null;
        returnToSelectAfterPlacementRef.current = false;
        editor.cancel();
        editor.setCurrentTool("select.idle");
        openCanvasAiChatAt(anchor);
      },
      selectTool(tool) {
        deactivatePiloEraser(editor);
        placementRequestRef.current = null;
        returnToSelectAfterPlacementRef.current =
          tool !== "select" && tool !== "text" && !connectionTools.has(tool);
        editor.cancel();
        editor.updateInstanceState({ isToolLocked: false });
        editor.setCurrentTool(tool === "select" ? "select.idle" : tool);
      },
      selectDrawingPreset(preset) {
        if (preset === "eraser") {
          activatePiloEraser(editor);
          return;
        }

        deactivatePiloEraser(editor);
        placementRequestRef.current = null;
        const shouldKeepDrawing = preset === "pen" || preset === "highlight";
        returnToSelectAfterPlacementRef.current = !shouldKeepDrawing;
        editor.cancel();
        editor.updateInstanceState({ isToolLocked: shouldKeepDrawing });

        if (preset === "highlight") {
          editor.setStyleForNextShapes(DefaultSizeStyle, "xl");
          editor.setCurrentTool("highlight");
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

        editor.setStyleForNextShapes(DefaultDashStyle, "draw");
        editor.setStyleForNextShapes(DefaultSizeStyle, "m");
        editor.setCurrentTool("draw");
      },
      setColor(color) {
        if (color === "default") {
          const { [DefaultColorStyle.id]: _color, ...stylesForNextShape } =
            editor.getInstanceState().stylesForNextShape;
          const selectedShapeColorUpdates = editor
            .getSelectedShapes()
            .flatMap((shape) => {
              const defaultProps = editor.getShapeUtil(shape).getDefaultProps();

              if (!("color" in defaultProps) || !("color" in shape.props)) {
                return [];
              }

              return [
                {
                  id: shape.id,
                  type: shape.type,
                  props: { color: defaultProps.color },
                } as unknown as TLShapePartial,
              ];
            });

          editor.updateInstanceState({ stylesForNextShape });

          if (selectedShapeColorUpdates.length) {
            editor.updateShapes(selectedShapeColorUpdates);
          }

          return;
        }

        editor.setStyleForNextShapes(DefaultColorStyle, color);

        if (editor.getSelectedShapeIds().length) {
          editor.setStyleForSelectedShapes(DefaultColorStyle, color);
        }
      },
      createNote() {
        deactivatePiloEraser(editor);
        placementRequestRef.current = null;
        returnToSelectAfterPlacementRef.current = true;
        editor.cancel();
        editor.updateInstanceState({ isToolLocked: false });
        editor.setCurrentTool("note");
      },
      createCodeBlock() {
        deactivatePiloEraser(editor);
        returnToSelectAfterPlacementRef.current = false;
        editor.cancel();
        editor.setCurrentTool("select.idle");
        placementRequestRef.current = {
          type: "code",
        };
      },
      createInsertableShape(tool, url) {
        deactivatePiloEraser(editor);
        returnToSelectAfterPlacementRef.current = false;
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
        editor.updateInstanceState({ isGridMode: enabled });
      },
      clearSelection() {
        deactivatePiloEraser(editor);
        placementRequestRef.current = null;
        returnToSelectAfterPlacementRef.current = false;
        editor.selectNone();
      },
      deleteSelection() {
        deleteSelectedShapes(editor);
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

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      const editor = editorRef.current;

      if (!editor || event.isPrimary === false) return;

      updateTrashDropZoneAttraction(editor, event);
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const editor = editorRef.current;

      if (!editor || event.isPrimary === false) return;
      clearTrashDropZoneAttraction();

      if (
        returnToSelectAfterPlacementRef.current &&
        !(event.target instanceof Element && event.target.closest(".canvas-tool-rail"))
      ) {
        window.requestAnimationFrame(() => {
          if (!returnToSelectAfterPlacementRef.current) return;

          returnToSelectAfterPlacementRef.current = false;
          editor.setCurrentTool("select.idle");
          onOneShotToolCreatedRef.current?.();
        });
      }

      if (!isPointerInsideTrashDropZone(event)) return;

      const selectedShapeIds = editor.getSelectedShapeIds();
      if (!selectedShapeIds.length) return;

      window.requestAnimationFrame(() => {
        editor.deleteShapes(selectedShapeIds);
      });
    }

    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: true,
    });
    window.addEventListener("pointerup", handlePointerUp, { capture: true });
    window.addEventListener("pointercancel", clearTrashDropZoneAttraction, {
      capture: true,
    });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, {
        capture: true,
      });
      window.removeEventListener("pointerup", handlePointerUp, {
        capture: true,
      });
      window.removeEventListener("pointercancel", clearTrashDropZoneAttraction, {
        capture: true,
      });
      clearTrashDropZoneAttraction();
    };
  }, []);

  function handleCanvasWheel(event: globalThis.WheelEvent) {
    const editor = editorRef.current;

    if (!editor) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        ".pilo-code-block input, .pilo-code-block select, .pilo-code-mirror",
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
      editor.setCurrentTool("select.idle");
      onOneShotToolCreatedRef.current?.();
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

      if (!isPiloFrameShape(currentFrame)) return;

      const frameShape = currentFrame;
      const descendantShapes = nextCollapsed
        ? collectFrameDescendantShapes(editor, frameShape.id)
        : [];
      const descendantShapeIds = descendantShapes.map(
        (shape) => shape.id as TLShapeId,
      );

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
          : {
              h: Math.max(frameShape.props.h, PILO_FRAME_EXPANDED_FALLBACK_SIZE.h),
              w: Math.max(frameShape.props.w, PILO_FRAME_EXPANDED_FALLBACK_SIZE.w),
            };

      if (nextCollapsed && descendantSnapshots.length) {
        onFrameChildShapesUnload(descendantSnapshots);
      }

      editor.run(
        () => {
          if (nextCollapsed && descendantShapes.length) {
            editor.deleteShapes(descendantShapeIds);
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

      const nextFreeformShapes = editor
        .getCurrentPageShapes()
        .map((shape) => withSerializedArrowBindings(editor, shape));

      onFreeformShapesDraftChange(nextFreeformShapes);
      onFreeformShapesChange(nextFreeformShapes);

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
      onFreeformShapesChange,
      onFreeformShapesDraftChange,
    ],
  );

  function handleCanvasPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
    if (
      event.target instanceof Element &&
      event.target.closest(".canvas-ai-chat")
    ) {
      return;
    }

    const editor = editorRef.current;

    if (!editor || event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        ".pilo-frame-toolbar, .pilo-code-block input, .pilo-code-block select, .pilo-code-mirror",
      )
    ) {
      return;
    }

    if (handlePiloEraserPointerDown(event, editor)) {
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

    // Frame and shape detail selection are select-tool affordances. Let an
    // active drawing tool receive its first click so an arrow can start from
    // a frame instead of the frame stealing that click.
    const currentToolId = editor.getCurrentToolId();
    const isSelectTool =
      currentToolId === "select" || currentToolId.startsWith("select.");

    if (!isSelectTool) {
      return;
    }

    const directShape = editor.getShapeAtPoint(pagePoint, {
      hitInside: true,
      hitLabels: true,
      hitLocked: true,
    });
    // Frames are filled hit targets, so getShapeAtPoint can return the frame
    // even when the pointer is directly on an arrow inside it. Prefer the
    // arrow here so a connector remains selectable.
    const pointedShape = getArrowAtPoint(editor, pagePoint) ?? directShape;

    if (isPiloCodeBlockShape(pointedShape)) {
      if (!editor.getSelectedShapeIds().includes(pointedShape.id)) {
        editor.setCurrentTool("select");
        editor.select(pointedShape.id);
      }

      requestShapeDetail(editor, pointedShape.id);
      return;
    }

    if (pointedShape && !isPiloFrameShape(pointedShape)) {
      requestShapeDetail(editor, pointedShape.id as TLShapeId);
      return;
    }

    const frameShape = isPiloFrameShape(pointedShape)
      ? pointedShape
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

    if (!frameShape.isLocked) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  function trackCanvasAiChatPointer(event: PointerEvent<HTMLDivElement>) {
    canvasAiChatPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handleCanvasPointerMoveCapture(event: PointerEvent<HTMLDivElement>) {
    if (handlePiloEraserPointerMove(event)) return;

    trackCanvasAiChatPointer(event);
  }

  function handleCanvasPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
    handlePiloEraserPointerEnd(event);
  }

  function handleCanvasPointerCancelCapture(event: PointerEvent<HTMLDivElement>) {
    handlePiloEraserPointerEnd(event);
  }

  function startCanvasAiChatHold(position: CanvasAiChatAnchor) {
    cancelCanvasAiChatHold();
    setCanvasAiChatAnchor(null);
    canvasAiChatHoldPositionRef.current = position;
    canvasAiChatHoldStartedAtRef.current = window.performance.now();
    setCanvasAiChatHoldProgress({ ...position, progress: 0 });

    function updateHoldProgress(timestamp: number) {
      const startedAt = canvasAiChatHoldStartedAtRef.current ?? timestamp;
      const holdPosition = canvasAiChatHoldPositionRef.current;

      if (!holdPosition) return;

      const progress = Math.min(
        1,
        (timestamp - startedAt) / CANVAS_AI_CHAT_HOLD_MS,
      );
      setCanvasAiChatHoldProgress({ ...holdPosition, progress });

      if (progress < 1) {
        canvasAiChatHoldFrameRef.current = window.requestAnimationFrame(
          updateHoldProgress,
        );
        return;
      }

      canvasAiChatHoldFrameRef.current = null;
      canvasAiChatHoldStartedAtRef.current = null;
      canvasAiChatHoldPositionRef.current = null;
      setCanvasAiChatHoldProgress(null);
      setCanvasAiChatAnchor(holdPosition);
    }

    canvasAiChatHoldFrameRef.current = window.requestAnimationFrame(
      updateHoldProgress,
    );
  }

  function cancelCanvasAiChatHold() {
    if (canvasAiChatHoldFrameRef.current !== null) {
      window.cancelAnimationFrame(canvasAiChatHoldFrameRef.current);
      canvasAiChatHoldFrameRef.current = null;
    }

    canvasAiChatHoldStartedAtRef.current = null;
    canvasAiChatHoldPositionRef.current = null;
    setCanvasAiChatHoldProgress(null);
  }

  function openCanvasAiChatAt(anchor: CanvasAiChatAnchor) {
    cancelCanvasAiChatHold();
    setCanvasAiChatAnchor((currentAnchor) => {
      if (currentAnchor) return null;

      return anchor;
    });
  }

  return (
    <div
      className={`h-full${isPiloEraserActive ? " is-pilo-eraser-active" : ""}`}
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onPointerMoveCapture={handleCanvasPointerMoveCapture}
      onPointerUpCapture={handleCanvasPointerUpCapture}
      onPointerCancelCapture={handleCanvasPointerCancelCapture}
    >
      <CanvasRemotePresenceProvider presence={presence?.remotePresence ?? []}>
        <TldrawSurface
          className="pilo-tldraw-canvas"
          hideUi
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
          shapeUtils={piloCanvasShapeUtils}
          components={tldrawComponents}
          onMount={mountEditor}
        >
          <CanvasWorkspaceLocationAdapter canvasId={board.id} />
          <CanvasLocalInteractionReporter
            onChange={handleLocalInteractionChange}
          />
          <CanvasStateReporter
            onFreeformShapesDraftChange={handleFreeformShapesDraftChange}
            onFreeformShapesChange={onFreeformShapesChange}
            onResolveFreeformShapeSnapshot={resolveRealtimePreviewSnapshot}
            onViewChange={onViewChange}
            onViewportBoundsChange={onViewportBoundsChange}
          />
          <CanvasRealtimePreviewApplier
            committedShapes={freeformShapes}
            isShapePatchProtected={isShapePatchProtected}
            originalShapesRef={remotePreviewOriginalShapesRef}
            protectionVersion={shapePatchVersion}
            previewShapeIdsRef={remotePreviewShapeIdsRef}
            previews={presence?.remoteShapePreviews ?? []}
          />
          <CanvasHistoryStateReporter
            onHistoryStateChange={onHistoryStateChange}
          />
          <CanvasFileDropImporter />
          {presence?.enabled ? <CanvasPresenceReporter presence={presence} /> : null}
          {presence ? (
            <RemoteCursorOverlay
              currentUserId={presence.currentUserId}
              cursorStore={presence.remoteCursorStore}
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
      </CanvasRemotePresenceProvider>
      <CanvasAiChatOverlay
        anchor={canvasAiChatAnchor}
        draft={canvasAgent.draft}
        error={canvasAgent.error}
        holdProgress={canvasAiChatHoldProgress}
        isRunning={canvasAgent.isRunning}
        onApplyDraft={canvasAgent.applyDraft}
        onClose={() => setCanvasAiChatAnchor(null)}
        onDiscardDraft={canvasAgent.discardDraft}
        onSubmit={canvasAgent.submit}
        statusMessage={canvasAgent.message}
      />
      <CanvasAgentVisualOverlay
        draft={canvasAgent.draft}
        editor={canvasEditor}
        playbackEnabled={canvasAgent.presentationMode !== "background"}
        progress={canvasAgent.progress}
      />
    </div>
  );
}

function CanvasLocalInteractionReporter({
  onChange,
}: {
  onChange: (state: PiloCanvasLocalInteractionState) => void;
}) {
  const editor = useEditor();
  const localInteractionState = useValue(
    "pilo-local-interaction-state",
    () => {
      const selectedShapeIds = editor.getSelectedShapeIds();
      const editingShapeId = editor.getEditingShapeId();
      const currentToolId = editor.getCurrentToolId();
      const pageState = editor.getCurrentPageState();

      return {
        currentToolId,
        editingShapeId: editingShapeId ? String(editingShapeId) : null,
        focusedGroupId: pageState.focusedGroupId
          ? String(pageState.focusedGroupId)
          : null,
        isFocused: editor.getIsFocused(),
        protectedShapeIds: getProtectedLocalShapeIds(
          selectedShapeIds,
          editingShapeId,
        ),
        selectedShapeIds: selectedShapeIds.map(String),
      };
    },
    [editor],
  );

  useEffect(() => {
    onChange(localInteractionState);
  }, [localInteractionState, onChange]);

  useEffect(
    () => () => {
      onChange(localInteractionStateIdle);
    },
    [onChange],
  );

  return null;
}

function CanvasRealtimePreviewApplier({
  committedShapes,
  isShapePatchProtected,
  originalShapesRef,
  protectionVersion,
  previewShapeIdsRef,
  previews,
}: {
  committedShapes: PiloCanvasFreeformShape[];
  isShapePatchProtected: (shapeId: string) => boolean;
  originalShapesRef: MutableRefObject<Map<string, PiloCanvasFreeformShape>>;
  protectionVersion: number;
  previewShapeIdsRef: MutableRefObject<Set<string>>;
  previews: CanvasShapePreviewEventPayload[];
}) {
  const editor = useEditor();
  const locallyEditingShapeId = useValue(
    "pilo-preview-local-editing-shape-id",
    () => {
      const editingShapeId = editor.getEditingShapeId();

      return editingShapeId ? String(editingShapeId) : null;
    },
    [editor],
  );
  const [previewDeleteCleanupVersion, setPreviewDeleteCleanupVersion] =
    useState(0);
  const previewDeleteGraceSinceRef = useRef(new Map<string, number>());
  const previewDeleteCleanupTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (previewDeleteCleanupTimerRef.current) {
      clearTimeout(previewDeleteCleanupTimerRef.current);
      previewDeleteCleanupTimerRef.current = null;
    }

    const activePreviewShapeIds = new Set<string>();
    const previewShapesById = new Map<string, PiloCanvasFreeformShape>();
    const previewDeletedShapeIds = new Set<string>();

    previews.forEach((preview) => {
      preview.shapes.forEach((shape) => {
        const previewShape = shape as PiloCanvasFreeformShape;
        const shapeId = getFreeformShapeId(previewShape);

        if (!shapeId) return;
        activePreviewShapeIds.add(shapeId);
        if (
          shapeId === locallyEditingShapeId ||
          isShapePatchProtected(shapeId)
        ) {
          return;
        }

        previewShapesById.set(shapeId, previewShape);
      });
      preview.deletedShapeIds?.forEach((shapeId) => {
        if (!shapeId) return;
        activePreviewShapeIds.add(shapeId);
        if (
          shapeId === locallyEditingShapeId ||
          isShapePatchProtected(shapeId)
        ) {
          return;
        }

        previewDeletedShapeIds.add(shapeId);
      });
    });

    const committedShapesById = new Map<string, PiloCanvasFreeformShape>();

    committedShapes.forEach((shape) => {
      const shapeId = getFreeformShapeId(shape);

      if (shapeId) {
        committedShapesById.set(shapeId, shape);
      }
    });

    const previousPreviewShapeIds = new Set(previewShapeIdsRef.current);
    const deferredProtectedRestoreShapeIds = Array.from(
      previousPreviewShapeIds,
    ).filter(
      (shapeId) =>
        !activePreviewShapeIds.has(shapeId) &&
        (shapeId === locallyEditingShapeId ||
          isShapePatchProtected(shapeId)),
    );
    const shapeIdsToRestore = Array.from(previousPreviewShapeIds).filter(
      (shapeId) =>
        !activePreviewShapeIds.has(shapeId) &&
        !deferredProtectedRestoreShapeIds.includes(shapeId),
    );
    const now = Date.now();
    const shapeIdsToDelete = shapeIdsToRestore.filter(
      (shapeId) => {
        if (
          committedShapesById.has(shapeId) ||
          originalShapesRef.current.has(shapeId)
        ) {
          previewDeleteGraceSinceRef.current.delete(shapeId);
          return false;
        }

        if (!editor.getShape(shapeId as TLShapeId)) {
          previewDeleteGraceSinceRef.current.delete(shapeId);
          return false;
        }

        const graceSince =
          previewDeleteGraceSinceRef.current.get(shapeId) ?? now;

        previewDeleteGraceSinceRef.current.set(shapeId, graceSince);

        return now - graceSince >= CANVAS_REMOTE_PREVIEW_DELETE_GRACE_MS;
      },
    );
    activePreviewShapeIds.forEach((shapeId) => {
      previewDeleteGraceSinceRef.current.delete(shapeId);
    });
    shapeIdsToDelete.forEach((shapeId) => {
      previewDeleteGraceSinceRef.current.delete(shapeId);
    });
    const pendingDeleteGraceShapeIds = shapeIdsToRestore.filter((shapeId) =>
      previewDeleteGraceSinceRef.current.has(shapeId),
    );

    if (pendingDeleteGraceShapeIds.length) {
      previewDeleteCleanupTimerRef.current = setTimeout(() => {
        previewDeleteCleanupTimerRef.current = null;
        setPreviewDeleteCleanupVersion((version) => version + 1);
      }, CANVAS_REMOTE_PREVIEW_DELETE_GRACE_MS);
    }
    const trackedPreviewShapeIds = new Set([
      ...activePreviewShapeIds,
      ...deferredProtectedRestoreShapeIds,
      ...pendingDeleteGraceShapeIds,
    ]);

    shapeIdsToDelete.forEach((shapeId) => {
      trackedPreviewShapeIds.delete(shapeId);
    });
    const shapesToRestore = shapeIdsToRestore.flatMap((shapeId) => {
      const committedShape = committedShapesById.get(shapeId);

      return committedShape ? [committedShape] : [];
    });
    const shapesToHide = Array.from(previewDeletedShapeIds).flatMap((shapeId) => {
      const currentShape = editor.getShape(shapeId as TLShapeId);

      if (!currentShape) return [];

      if (!originalShapesRef.current.has(shapeId)) {
        originalShapesRef.current.set(
          shapeId,
          withSerializedArrowBindings(editor, currentShape),
        );
      }

      return [
        {
          ...withSerializedArrowBindings(editor, currentShape),
          opacity: 0,
        } as PiloCanvasFreeformShape,
      ];
    });
    const shapesToPreview = Array.from(previewShapesById.values()).filter(
      (shape) => {
        const shapeId = getFreeformShapeId(shape);
        const currentShape = shapeId
          ? editor.getShape(shapeId as TLShapeId)
          : null;

        if (!shapeId || !currentShape || currentShape.type !== shape.type) {
          return false;
        }

        if (!originalShapesRef.current.has(shapeId)) {
          originalShapesRef.current.set(
            shapeId,
            withSerializedArrowBindings(editor, currentShape),
          );
        }

        return true;
      },
    );
    const shapesToCreate = Array.from(previewShapesById.values()).filter(
      (shape) => {
        const shapeId = getFreeformShapeId(shape);
        const currentShape = shapeId
          ? editor.getShape(shapeId as TLShapeId)
          : null;

        return Boolean(shapeId && !currentShape);
      },
    );

    if (
      shapeIdsToDelete.length ||
      shapesToRestore.length ||
      shapesToHide.length ||
      shapesToPreview.length ||
      shapesToCreate.length
    ) {
      previewShapeIdsRef.current = trackedPreviewShapeIds;

      editor.store.mergeRemoteChanges(() => {
        editor.run(
          () => {
            if (shapeIdsToDelete.length) {
              editor.deleteShapes(shapeIdsToDelete as TLShapeId[]);
            }

            if (shapesToRestore.length) {
              restorePiloShapeAssets(editor, shapesToRestore);
              editor.updateShapes(shapesToRestore as TLShapePartial<TLShape>[]);
            }

            if (shapesToHide.length) {
              editor.updateShapes(shapesToHide as TLShapePartial<TLShape>[]);
            }

            if (shapesToPreview.length) {
              restorePiloShapeAssets(editor, shapesToPreview);
              editor.updateShapes(shapesToPreview as TLShapePartial<TLShape>[]);
            }

            if (shapesToCreate.length) {
              restorePiloShapeAssets(editor, shapesToCreate);
              editor.createShapes(sortFreeformShapesForCreate(shapesToCreate));
            }
          },
          { history: "ignore" },
        );
      });
    }

    shapeIdsToRestore.forEach((shapeId) => {
      originalShapesRef.current.delete(shapeId);
    });

    if (
      !shapeIdsToDelete.length &&
      !shapesToRestore.length &&
      !shapesToHide.length &&
      !shapesToPreview.length &&
      !shapesToCreate.length
    ) {
      previewShapeIdsRef.current = trackedPreviewShapeIds;
    }
  }, [
    committedShapes,
    editor,
    isShapePatchProtected,
    locallyEditingShapeId,
    originalShapesRef,
    previewDeleteCleanupVersion,
    previewShapeIdsRef,
    previews,
    protectionVersion,
  ]);

  useEffect(
    () => () => {
      if (previewDeleteCleanupTimerRef.current) {
        clearTimeout(previewDeleteCleanupTimerRef.current);
        previewDeleteCleanupTimerRef.current = null;
      }

      const shapesToRestore = Array.from(originalShapesRef.current.values());

      if (shapesToRestore.length) {
        editor.store.mergeRemoteChanges(() => {
          editor.run(
            () => {
              restorePiloShapeAssets(editor, shapesToRestore);
              editor.updateShapes(shapesToRestore as TLShapePartial<TLShape>[]);
            },
            { history: "ignore" },
          );
        });
      }

      originalShapesRef.current.clear();
      previewShapeIdsRef.current.clear();
    },
    [editor, originalShapesRef, previewShapeIdsRef],
  );

  return null;
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
  nextCursor: CanvasPresencePoint | null,
) {
  if (!nextCursor) {
    return previousCursor !== null;
  }

  if (!previousCursor) {
    return true;
  }

  return (
    Math.hypot(
      nextCursor.x - previousCursor.x,
      nextCursor.y - previousCursor.y,
    ) >= CANVAS_PRESENCE_CURSOR_MIN_DISTANCE
  );
}

function hasSamePresenceEditingIntent(
  previousIntent: {
    editingMode: CanvasPresenceEditingMode | null;
    editingShapeId: string | null;
  },
  nextIntent: {
    editingMode: CanvasPresenceEditingMode | null;
    editingShapeId: string | null;
  },
) {
  return (
    previousIntent.editingMode === nextIntent.editingMode &&
    previousIntent.editingShapeId === nextIntent.editingShapeId
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

function getCanvasPresenceEditingMode({
  currentToolId,
  editingShapeId,
  editor,
  selectedShapeIds,
}: {
  currentToolId: string;
  editingShapeId: string | null;
  editor: Editor;
  selectedShapeIds: string[];
}): CanvasPresenceEditingMode | null {
  if (editingShapeId) {
    const editingShape = editor.getShape(editingShapeId as TLShapeId);

    return editingShape && isPiloCodeBlockShape(editingShape) ? "code" : "text";
  }

  if (currentToolId.includes("draw")) return "draw";
  if (currentToolId.includes("hand")) return "hand";
  if (currentToolId.includes("resize")) return "resize";
  if (currentToolId.includes("translate")) return "move";
  if (currentToolId !== "select.idle" && currentToolId !== "select") {
    return "placement";
  }

  return selectedShapeIds.length ? "select" : null;
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
  const editingShapeId = useValue(
    "pilo-presence-editing-shape-id",
    () => {
      const nextEditingShapeId = editor.getEditingShapeId();

      return nextEditingShapeId ? String(nextEditingShapeId) : null;
    },
    [editor],
  );
  const currentToolId = useValue(
    "pilo-presence-current-tool-id",
    () => editor.getCurrentToolId(),
    [editor],
  );
  const editingMode = getCanvasPresenceEditingMode({
    currentToolId,
    editingShapeId,
    editor,
    selectedShapeIds,
  });
  const selectedShapeIdsRef = useRef<string[]>(selectedShapeIds);
  const editingIntentRef = useRef<{
    editingMode: CanvasPresenceEditingMode | null;
    editingShapeId: string | null;
  }>({ editingMode, editingShapeId });
  const lastSentAtRef = useRef(0);
  const lastSentPayloadRef = useRef<{
    cursor: CanvasPresencePoint | null;
    editingMode: CanvasPresenceEditingMode | null;
    editingShapeId: string | null;
    selectedShapeIds: string[];
  }>({
    cursor: null,
    editingMode: null,
    editingShapeId: null,
    selectedShapeIds: [],
  });
  const pendingCursorRef = useRef<CanvasPresencePoint | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    selectedShapeIdsRef.current = selectedShapeIds;
  }, [selectedShapeIds]);

  useEffect(() => {
    editingIntentRef.current = { editingMode, editingShapeId };
  }, [editingMode, editingShapeId]);

  const flushPresence = useCallback(
    (cursor: CanvasPresencePoint | null) => {
      const nextSelectedShapeIds = selectedShapeIdsRef.current;
      const nextEditingIntent = editingIntentRef.current;
      const lastPayload = lastSentPayloadRef.current;

      if (
        !hasCursorMovedEnough(lastPayload.cursor, cursor) &&
        hasSameSelectedShapeIds(
          lastPayload.selectedShapeIds,
          nextSelectedShapeIds,
        ) &&
        hasSamePresenceEditingIntent(lastPayload, nextEditingIntent)
      ) {
        return;
      }

      sendPresenceUpdate(
        cursor,
        nextSelectedShapeIds,
        getCanvasPresenceViewport(editor),
        nextEditingIntent.editingShapeId,
        nextEditingIntent.editingMode,
      );
      lastSentAtRef.current = Date.now();
      lastSentPayloadRef.current = {
        cursor,
        ...nextEditingIntent,
        selectedShapeIds: nextSelectedShapeIds,
      };
    },
    [editor, sendPresenceUpdate],
  );

  const schedulePresence = useCallback(
    (cursor: CanvasPresencePoint) => {
      pendingCursorRef.current = cursor;

      const elapsedMs = Date.now() - lastSentAtRef.current;
      if (elapsedMs >= CANVAS_PRESENCE_CURSOR_THROTTLE_MS) {
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
      }, CANVAS_PRESENCE_CURSOR_THROTTLE_MS - elapsedMs);
    },
    [flushPresence],
  );

  useEffect(() => {
    if (!presence.enabled) {
      return;
    }

    flushPresence(lastSentPayloadRef.current.cursor);
  }, [editingMode, editingShapeId, flushPresence, presence.enabled, selectedShapeIds]);

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
