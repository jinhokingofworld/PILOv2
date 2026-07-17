import type { Editor } from "tldraw";

export const CLASSIC_CANVAS_INITIAL_ZOOM = 1;

const CLASSIC_CANVAS_ORIGIN = { x: 0, y: 0 } as const;

/**
 * Starts Classic Canvas at 100% with the page origin centered inside the
 * actual tldraw viewport. The viewport already excludes the app header and
 * sidebar because it is measured from the editor container.
 */
export function resetClassicCanvasCamera(editor: Editor) {
  editor.setCamera(
    {
      ...editor.getCamera(),
      z: CLASSIC_CANVAS_INITIAL_ZOOM,
    },
    { force: true, immediate: true },
  );
  editor.centerOnPoint(CLASSIC_CANVAS_ORIGIN, {
    force: true,
    immediate: true,
  });
}
