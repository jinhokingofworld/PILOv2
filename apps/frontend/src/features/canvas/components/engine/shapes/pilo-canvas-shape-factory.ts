"use client";

import {
  createShapeId,
  type TLCreateShapePartial,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import type {
  PiloStickyNoteColor,
  PiloStickyNoteShape,
} from "./sticky-note/PiloStickyNoteShapeUtil";
import type { PiloCodeBlockShape } from "./code-block/PiloCodeBlockShapeUtil";
import {
  createPiloAssetId,
  type PiloMediaAsset,
} from "../assets/pilo-canvas-assets";
import type { PiloCanvasFreeformShape } from "../types";

export type PiloInsertableTool = "image" | "video" | "bookmark" | "embed";

type PiloStickyNotePartial = TLCreateShapePartial<PiloStickyNoteShape> & {
  id: TLShapeId;
};
type PiloCodeBlockPartial = TLCreateShapePartial<PiloCodeBlockShape> & {
  id: TLShapeId;
};

export function createStickyNoteShape(
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

export function createCodeBlockShape(
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

export function createInsertableShape(
  index: number,
  position: { x: number; y: number },
  request: {
    type: PiloInsertableTool;
    url: string;
  },
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

export function sortFreeformShapesForCreate(
  shapes: PiloCanvasFreeformShape[],
) {
  return [...shapes].sort((first, second) => {
    const firstParent =
      first.type === "frame" || first.type === "pilo-code-block";
    const secondParent =
      second.type === "frame" || second.type === "pilo-code-block";

    if (firstParent === secondParent) return 0;

    return firstParent ? -1 : 1;
  });
}
