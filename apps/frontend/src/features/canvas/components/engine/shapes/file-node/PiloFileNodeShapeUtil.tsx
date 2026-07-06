"use client";

export const PILO_FILE_NODE_SHAPE_TYPE = "file_node" as const;

export type PiloFileNodeShapeType = typeof PILO_FILE_NODE_SHAPE_TYPE;

export type PiloFileNodeShapeProps = {
  w: number;
  h: number;
  fileId: string | null;
  fileName: string;
  mimeType: string | null;
  url: string | null;
};

// Reserved for the follow-up file_node implementation.
// When the shape is ready, add its ShapeUtil to pilo-canvas-shape-utils
// and add PILO_FILE_NODE_SHAPE_TYPE to canvas-storage persistableShapeTypes.
