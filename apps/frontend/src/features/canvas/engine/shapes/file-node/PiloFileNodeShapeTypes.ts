import type { TLBaseShape } from "tldraw";

export type PiloFileNodeShapeProps = {
  w: number;
  h: number;
  fileId: string;
  fileName: string;
  mimeType: string;
};

export type PiloFileNodeShape = TLBaseShape<"file_node", PiloFileNodeShapeProps>;

export const DEFAULT_PILO_FILE_NODE_PROPS: PiloFileNodeShapeProps = {
  w: 420,
  h: 280,
  fileId: "",
  fileName: "Drive file",
  mimeType: "application/octet-stream",
};

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    file_node: PiloFileNodeShapeProps;
  }
}
