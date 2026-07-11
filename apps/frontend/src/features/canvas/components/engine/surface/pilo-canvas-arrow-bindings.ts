import type {
  Editor,
  TLArrowBinding,
  TLBindingCreate,
  TLShape,
  TLShapeId,
} from "tldraw";
import type { PiloCanvasFreeformShape } from "../types";

const PILO_ARROW_BINDINGS_META_KEY = "piloArrowBindingsV1";

type PiloArrowBindingTerminal = "start" | "end";

export type PiloArrowBindingSnapshot = {
  id?: string;
  type: "arrow";
  typeName?: "binding";
  fromId: string;
  toId: string;
  props: {
    terminal: PiloArrowBindingTerminal;
    normalizedAnchor: {
      x: number;
      y: number;
    };
    isExact: boolean;
    isPrecise: boolean;
    snap?: "center" | "edge-point" | "edge" | "none";
  };
  meta?: TLArrowBinding["meta"];
};

type PiloArrowBindingRestoreResult = {
  pending: PiloArrowBindingSnapshot[];
  restored: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneFreeformShape(shape: TLShape | PiloCanvasFreeformShape) {
  return JSON.parse(JSON.stringify(shape)) as PiloCanvasFreeformShape;
}

function cloneBindingMeta(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as TLArrowBinding["meta"];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isArrowBindingTerminal(
  value: unknown,
): value is PiloArrowBindingTerminal {
  return value === "start" || value === "end";
}

function normalizeArrowBindingSnapshot(
  value: unknown,
): PiloArrowBindingSnapshot | null {
  if (!isRecord(value) || value.type !== "arrow") return null;
  if (typeof value.fromId !== "string" || typeof value.toId !== "string") {
    return null;
  }

  const props = value.props;
  if (!isRecord(props) || !isArrowBindingTerminal(props.terminal)) {
    return null;
  }

  const normalizedAnchor = props.normalizedAnchor;
  if (
    !isRecord(normalizedAnchor) ||
    !isFiniteNumber(normalizedAnchor.x) ||
    !isFiniteNumber(normalizedAnchor.y) ||
    typeof props.isExact !== "boolean" ||
    typeof props.isPrecise !== "boolean"
  ) {
    return null;
  }

  return {
    id: typeof value.id === "string" ? value.id : undefined,
    type: "arrow",
    typeName: "binding",
    fromId: value.fromId,
    toId: value.toId,
    props: {
      terminal: props.terminal,
      normalizedAnchor: {
        x: normalizedAnchor.x,
        y: normalizedAnchor.y,
      },
      isExact: props.isExact,
      isPrecise: props.isPrecise,
      snap:
        props.snap === "center" ||
        props.snap === "edge-point" ||
        props.snap === "edge" ||
        props.snap === "none"
          ? props.snap
          : undefined,
    },
    meta: isRecord(value.meta) ? cloneBindingMeta(value.meta) : {},
  };
}

function toArrowBindingSnapshot(
  binding: TLArrowBinding,
): PiloArrowBindingSnapshot {
  return {
    id: binding.id,
    type: "arrow",
    typeName: "binding",
    fromId: binding.fromId,
    toId: binding.toId,
    props: {
      terminal: binding.props.terminal,
      normalizedAnchor: {
        x: binding.props.normalizedAnchor.x,
        y: binding.props.normalizedAnchor.y,
      },
      isExact: binding.props.isExact,
      isPrecise: binding.props.isPrecise,
      snap: binding.props.snap,
    },
    meta: cloneBindingMeta(binding.meta),
  };
}

function getArrowBindingSnapshotKey(snapshot: PiloArrowBindingSnapshot) {
  return [
    snapshot.fromId,
    snapshot.toId,
    snapshot.props.terminal,
    snapshot.props.normalizedAnchor.x,
    snapshot.props.normalizedAnchor.y,
  ].join("|");
}

function hasArrowBindingSnapshot(
  binding: TLArrowBinding,
  snapshot: PiloArrowBindingSnapshot,
) {
  return (
    getArrowBindingSnapshotKey(toArrowBindingSnapshot(binding)) ===
    getArrowBindingSnapshotKey(snapshot)
  );
}

export function withSerializedArrowBindings(
  editor: Editor,
  shape: TLShape,
): PiloCanvasFreeformShape {
  const snapshot = cloneFreeformShape(shape);
  const meta: TLShape["meta"] = isRecord(snapshot.meta)
    ? { ...snapshot.meta }
    : {};

  if (shape.type !== "arrow") {
    delete meta[PILO_ARROW_BINDINGS_META_KEY];
    return {
      ...snapshot,
      meta,
    };
  }

  const bindings = editor
    .getBindingsInvolvingShape(shape.id, "arrow")
    .filter(
      (binding) =>
        binding.fromId === shape.id &&
        (binding.props.terminal === "start" ||
          binding.props.terminal === "end"),
    )
    .map(toArrowBindingSnapshot);

  if (bindings.length) {
    meta[PILO_ARROW_BINDINGS_META_KEY] = JSON.parse(JSON.stringify(bindings));
  } else {
    delete meta[PILO_ARROW_BINDINGS_META_KEY];
  }

  return {
    ...snapshot,
    meta,
  };
}

export function readSerializedArrowBindings(
  shape: PiloCanvasFreeformShape,
): PiloArrowBindingSnapshot[] {
  if (shape.type !== "arrow" || !isRecord(shape.meta)) return [];

  const value = shape.meta[PILO_ARROW_BINDINGS_META_KEY];
  if (!Array.isArray(value)) return [];

  return value
    .map(normalizeArrowBindingSnapshot)
    .filter((binding): binding is PiloArrowBindingSnapshot => Boolean(binding));
}

export function restoreSerializedArrowBindings(
  editor: Editor,
  bindings: PiloArrowBindingSnapshot[],
): PiloArrowBindingRestoreResult {
  const pending: PiloArrowBindingSnapshot[] = [];
  const createBindings: TLBindingCreate<TLArrowBinding>[] = [];
  const existingArrowBindings = new Set(
    editor.store
      .allRecords()
      .filter(
        (record): record is TLArrowBinding =>
          isRecord(record) &&
          record.typeName === "binding" &&
          record.type === "arrow",
      )
      .map((binding) => binding.id),
  );

  bindings.forEach((binding) => {
    const fromShape = editor.getShape(binding.fromId as TLShapeId);
    const toShape = editor.getShape(binding.toId as TLShapeId);

    if (!fromShape || !toShape) {
      pending.push(binding);
      return;
    }

    const alreadyRestored = editor
      .getBindingsInvolvingShape(binding.fromId as TLShapeId, "arrow")
      .some((existingBinding) =>
        hasArrowBindingSnapshot(existingBinding, binding),
      );

    if (alreadyRestored) return;

    createBindings.push({
      id:
        binding.id &&
        !existingArrowBindings.has(binding.id as TLArrowBinding["id"])
          ? (binding.id as TLArrowBinding["id"])
          : undefined,
      type: "arrow",
      fromId: binding.fromId as TLShapeId,
      toId: binding.toId as TLShapeId,
      props: binding.props,
      meta: binding.meta ?? {},
    });
  });

  if (createBindings.length) {
    editor.createBindings(createBindings);
  }

  return {
    pending,
    restored: createBindings.length,
  };
}

export function removeStaleSerializedArrowBindings(
  editor: Editor,
  shapes: PiloCanvasFreeformShape[],
) {
  const staleBindings: TLArrowBinding[] = [];

  shapes.forEach((shape) => {
    const shapeId = typeof shape.id === "string" ? shape.id : null;
    const desiredBindings = readSerializedArrowBindings(shape);

    if (shape.type !== "arrow" || !shapeId || !desiredBindings.length) {
      return;
    }

    const desiredBindingKeys = new Set(
      desiredBindings.map(getArrowBindingSnapshotKey),
    );

    editor
      .getBindingsInvolvingShape(shapeId as TLShapeId, "arrow")
      .filter((binding) => binding.fromId === shapeId)
      .forEach((binding) => {
        const bindingKey = getArrowBindingSnapshotKey(
          toArrowBindingSnapshot(binding),
        );

        if (!desiredBindingKeys.has(bindingKey)) {
          staleBindings.push(binding);
        }
      });
  });

  if (staleBindings.length) {
    editor.deleteBindings(staleBindings);
  }
}
