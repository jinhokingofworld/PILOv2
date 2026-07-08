"use client";

import {
  createCustomRecordId,
  type Editor,
  type TLAsset,
  type TLAssetId,
  type TLShape,
} from "tldraw";
import type { PiloCanvasFreeformShape } from "../types";

export type PiloMediaAsset = Extract<TLAsset, { type: "image" | "video" }>;

const PILO_ASSET_META_KEY = "piloAsset";

type PiloShapeWithMediaAssetMeta = TLShape & {
  meta: TLShape["meta"] & {
    piloAsset?: PiloMediaAsset;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMediaAsset(asset: TLAsset | undefined): asset is PiloMediaAsset {
  return asset?.type === "image" || asset?.type === "video";
}

function cloneMediaAsset(asset: PiloMediaAsset): TLShape["meta"][string] {
  return JSON.parse(JSON.stringify(asset)) as TLShape["meta"][string];
}

export function createPiloAssetId(prefix: string, index: number) {
  return createCustomRecordId(
    "asset",
    `pilo-${prefix}-${Date.now()}-${index}`,
  ) as TLAssetId;
}

export function withPiloMediaAsset(
  editor: Editor,
  shape: PiloCanvasFreeformShape,
): PiloCanvasFreeformShape {
  const meta = isRecord(shape.meta) ? { ...shape.meta } : {};

  if (shape.type !== "image" && shape.type !== "video") {
    delete meta[PILO_ASSET_META_KEY];

    return {
      ...shape,
      meta,
    };
  }

  const props = isRecord(shape.props) ? shape.props : {};
  const assetId =
    typeof props.assetId === "string" ? (props.assetId as TLAssetId) : null;
  const asset = assetId ? editor.getAsset(assetId) : undefined;

  if (isMediaAsset(asset)) {
    meta[PILO_ASSET_META_KEY] = cloneMediaAsset(asset);
  } else {
    delete meta[PILO_ASSET_META_KEY];
  }

  return {
    ...shape,
    meta,
  };
}

export function restorePiloShapeAssets(
  editor: Editor,
  shapes: PiloCanvasFreeformShape[],
) {
  const assets = shapes
    .map((shape) => (shape as PiloShapeWithMediaAssetMeta).meta?.piloAsset)
    .filter((asset): asset is PiloMediaAsset => Boolean(asset));

  if (assets.length) {
    editor.createAssets(assets);
  }
}
