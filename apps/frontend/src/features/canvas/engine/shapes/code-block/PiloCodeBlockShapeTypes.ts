import type { TLBaseShape } from "tldraw";

export const piloCodeLanguages = [
  "tsx",
  "ts",
  "jsx",
  "js",
  "json",
  "css",
  "html",
  "md",
  "sql",
  "py",
  "c",
] as const;

export type PiloCodeLanguage = (typeof piloCodeLanguages)[number];

export type PiloCodeBlockShapeProps = {
  w: number;
  h: number;
  fileName: string;
  language: PiloCodeLanguage;
  code: string;
  isCollapsed?: boolean;
  scrollY?: number;
};

export type PiloCodeBlockShape = TLBaseShape<
  "pilo-code-block",
  PiloCodeBlockShapeProps
>;

export const PILO_COLLAPSED_CODE_BLOCK_SIZE = {
  h: 144,
  w: 360,
} as const;

export const DEFAULT_PILO_CODE_BLOCK_PROPS: PiloCodeBlockShape["props"] = {
  w: 840,
  h: 520,
  fileName: "canvas-node.tsx",
  language: "tsx",
  code: "export function CanvasNode() {\n  return <div>PILO</div>;\n}",
  isCollapsed: false,
  scrollY: 0,
};

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "pilo-code-block": PiloCodeBlockShapeProps;
  }
}
