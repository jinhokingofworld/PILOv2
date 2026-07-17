"use client";

import {
  createShapeId,
  type TLCreateShapePartial,
  type TLFrameShape,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import {
  DEFAULT_PILO_CODE_BLOCK_PROPS,
  type PiloCodeLanguage,
  type PiloCodeBlockShape,
} from "./code-block/PiloCodeBlockShapeTypes";
import {
  createPiloAssetId,
  type PiloMediaAsset,
} from "../assets/pilo-canvas-assets";
import type { PiloCanvasFreeformShape } from "../canvas-engine-types";

export type PiloInsertableTool = "image" | "video" | "bookmark" | "embed";

type PiloCodeBlockPartial = TLCreateShapePartial<PiloCodeBlockShape> & {
  id: TLShapeId;
};
type PiloFramePartial = TLCreateShapePartial<TLFrameShape> & {
  id: TLShapeId;
};

export const PILO_IMPORTED_CODE_BLOCK_WIDTH = 460;
export const PILO_IMPORTED_CODE_BLOCK_HEIGHT = 300;
export const PILO_IMPORTED_CODE_FOLDER_MAX_COLUMNS = 3;
export const PILO_IMPORTED_CODE_FOLDER_GAP_X = 56;
export const PILO_IMPORTED_CODE_FOLDER_GAP_Y = 64;
export const PILO_IMPORTED_CODE_FOLDER_PADDING = 40;
export const PILO_IMPORTED_CODE_FOLDER_HEADER_HEIGHT = 52;

type ImportedCodeFileInput = {
  code: string;
  fileName: string;
  language: PiloCodeLanguage;
};

type ImportedCodeFolderInput = {
  files: ImportedCodeFileInput[];
  folderName: string;
  folders?: ImportedCodeFolderInput[];
};

type ImportedCodeFolderLayoutItem =
  | {
      file: ImportedCodeFileInput;
      h: number;
      kind: "file";
      w: number;
      x: number;
      y: number;
    }
  | {
      h: number;
      kind: "folder";
      layout: ImportedCodeFolderLayout;
      w: number;
      x: number;
      y: number;
    };

type ImportedCodeFolderLayout = {
  folder: ImportedCodeFolderInput;
  frameSize: { h: number; w: number };
  items: ImportedCodeFolderLayoutItem[];
};

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
      ...DEFAULT_PILO_CODE_BLOCK_PROPS,
      w: width,
      h: height,
    },
  };
}

export function createImportedCodeBlockShape(
  index: number,
  position: { x: number; y: number },
  file: {
    code: string;
    fileName: string;
    language: PiloCodeLanguage;
  },
  parentId?: TLShapeId,
): PiloCodeBlockPartial {
  const shape: PiloCodeBlockPartial = {
    id: createShapeId(`pilo-code-import-${Date.now()}-${index}`),
    type: "pilo-code-block",
    x: position.x,
    y: position.y,
    props: {
      ...DEFAULT_PILO_CODE_BLOCK_PROPS,
      w: PILO_IMPORTED_CODE_BLOCK_WIDTH,
      h: PILO_IMPORTED_CODE_BLOCK_HEIGHT,
      fileName: file.fileName,
      language: file.language,
      code: file.code,
      scrollY: 0,
    },
  };

  if (parentId) {
    shape.parentId = parentId;
  }

  return shape;
}

function createImportedCodeFolderLayout(
  folder: ImportedCodeFolderInput,
): ImportedCodeFolderLayout {
  const childFolderItems = (folder.folders ?? []).map((childFolder) => {
    const layout = createImportedCodeFolderLayout(childFolder);

    return {
      h: layout.frameSize.h,
      kind: "folder" as const,
      layout,
      w: layout.frameSize.w,
      x: 0,
      y: 0,
    };
  });
  const fileItems = folder.files.map((file) => ({
    file,
    h: PILO_IMPORTED_CODE_BLOCK_HEIGHT,
    kind: "file" as const,
    w: PILO_IMPORTED_CODE_BLOCK_WIDTH,
    x: 0,
    y: 0,
  }));
  const items = [...childFolderItems, ...fileItems];
  const hasNestedFolder = childFolderItems.length > 0;
  const maxColumns = hasNestedFolder
    ? Math.min(2, Math.max(1, items.length))
    : Math.min(PILO_IMPORTED_CODE_FOLDER_MAX_COLUMNS, Math.max(1, items.length));
  const rows: Array<typeof items> = [];

  for (let index = 0; index < items.length; index += maxColumns) {
    rows.push(items.slice(index, index + maxColumns));
  }

  const rowSizes = rows.map((row) => ({
    h: Math.max(...row.map((item) => item.h)),
    w:
      row.reduce((width, item) => width + item.w, 0) +
      Math.max(0, row.length - 1) * PILO_IMPORTED_CODE_FOLDER_GAP_X,
  }));
  const contentWidth = Math.max(
    PILO_IMPORTED_CODE_BLOCK_WIDTH,
    ...rowSizes.map((row) => row.w),
  );
  const contentHeight = Math.max(
    PILO_IMPORTED_CODE_BLOCK_HEIGHT,
    rowSizes.reduce((height, row, index) => {
      return (
        height +
        row.h +
        (index === rowSizes.length - 1 ? 0 : PILO_IMPORTED_CODE_FOLDER_GAP_Y)
      );
    }, 0),
  );
  let nextY =
    PILO_IMPORTED_CODE_FOLDER_HEADER_HEIGHT + PILO_IMPORTED_CODE_FOLDER_PADDING;

  rows.forEach((row, rowIndex) => {
    const rowSize = rowSizes[rowIndex];
    let nextX =
      PILO_IMPORTED_CODE_FOLDER_PADDING + (contentWidth - rowSize.w) / 2;

    row.forEach((item) => {
      item.x = nextX;
      item.y = nextY;
      nextX += item.w + PILO_IMPORTED_CODE_FOLDER_GAP_X;
    });

    nextY += rowSize.h + PILO_IMPORTED_CODE_FOLDER_GAP_Y;
  });

  return {
    folder,
    frameSize: {
      h:
        PILO_IMPORTED_CODE_FOLDER_HEADER_HEIGHT +
        PILO_IMPORTED_CODE_FOLDER_PADDING * 2 +
        contentHeight,
      w: PILO_IMPORTED_CODE_FOLDER_PADDING * 2 + contentWidth,
    },
    items,
  };
}

export function createImportedCodeFolderShapes(
  index: number,
  position: { x: number; y: number },
  folder: ImportedCodeFolderInput,
): {
  codeBlocks: PiloCodeBlockPartial[];
  frame: PiloFramePartial;
  frameSize: { h: number; w: number };
  frames: PiloFramePartial[];
  shapes: Array<PiloFramePartial | PiloCodeBlockPartial>;
} {
  const layout = createImportedCodeFolderLayout(folder);
  const codeBlocks: PiloCodeBlockPartial[] = [];
  const frames: PiloFramePartial[] = [];
  const shapes: Array<PiloFramePartial | PiloCodeBlockPartial> = [];
  let shapeIndex = index;

  function nextShapeIndex() {
    shapeIndex += 1;

    return shapeIndex;
  }

  function createFrameTree(
    currentLayout: ImportedCodeFolderLayout,
    origin: { x: number; y: number },
    parentId?: TLShapeId,
  ) {
    const frame: PiloFramePartial = {
      id: createShapeId(`pilo-code-folder-${Date.now()}-${nextShapeIndex()}`),
      type: "frame",
      x: origin.x,
      y: origin.y,
      props: {
        w: currentLayout.frameSize.w,
        h: currentLayout.frameSize.h,
        name: currentLayout.folder.folderName,
        color: "blue",
      },
    };

    if (parentId) {
      frame.parentId = parentId;
    }

    frames.push(frame);
    shapes.push(frame);

    currentLayout.items.forEach((item) => {
      if (item.kind === "folder") {
        createFrameTree(
          item.layout,
          {
            x: item.x,
            y: item.y,
          },
          frame.id,
        );
        return;
      }

      const codeBlock = createImportedCodeBlockShape(
        nextShapeIndex(),
        {
          x: item.x,
          y: item.y,
        },
        item.file,
        frame.id,
      );

      codeBlocks.push(codeBlock);
      shapes.push(codeBlock);
    });

    return frame;
  }

  const frame = createFrameTree(layout, {
    x: position.x - layout.frameSize.w / 2,
    y: position.y - layout.frameSize.h / 2,
  });

  return {
    codeBlocks,
    frame,
    frameSize: layout.frameSize,
    frames,
    shapes,
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
  const shapeMap = new Map(
    shapes
      .filter((shape): shape is PiloCanvasFreeformShape & { id: TLShapeId } =>
        Boolean(shape.id),
      )
      .map((shape) => [shape.id, shape]),
  );

  function getShapeDepth(shape: PiloCanvasFreeformShape) {
    let depth = 0;
    let parentId = shape.parentId;

    while (parentId && shapeMap.has(parentId as TLShapeId)) {
      depth += 1;
      parentId = shapeMap.get(parentId as TLShapeId)?.parentId;
    }

    return depth;
  }

  return [...shapes].sort((first, second) => {
    const depthDiff = getShapeDepth(first) - getShapeDepth(second);

    if (depthDiff !== 0) return depthDiff;

    const firstParent = first.type === "frame";
    const secondParent = second.type === "frame";

    if (firstParent === secondParent) return 0;

    return firstParent ? -1 : 1;
  });
}
