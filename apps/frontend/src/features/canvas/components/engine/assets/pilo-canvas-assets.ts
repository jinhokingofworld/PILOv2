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

type PiloShapeWithMediaAssetMeta = TLShape & {
  meta: TLShape["meta"] & {
    piloAsset?: PiloMediaAsset;
  };
};

export function createPiloAssetId(prefix: string, index: number) {
  return createCustomRecordId(
    "asset",
    `pilo-${prefix}-${Date.now()}-${index}`,
  ) as TLAssetId;
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
