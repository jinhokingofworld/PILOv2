"use client";

import { useId, useRef } from "react";
import { toDomPrecision, useEditor } from "tldraw";
import { useQuickReactor } from "@tldraw/state-react";

function toGridOffset(cameraValue: number, size: number, zoom: number) {
  return toDomPrecision((cameraValue * zoom) % size);
}

export function PiloCanvasBackground() {
  const editor = useEditor();
  const id = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const smallPatternRef = useRef<SVGPatternElement>(null);
  const largePatternRef = useRef<SVGPatternElement>(null);
  const smallPathRef = useRef<SVGPathElement>(null);
  const largePathRef = useRef<SVGPathElement>(null);
  const smallGridId = `${id}-small-grid`;
  const largeGridId = `${id}-large-grid`;

  useQuickReactor(
    "pilo-camera-aware-grid",
    () => {
      const camera = editor.getCamera();
      const smallSize = 32 * camera.z;
      const largeSize = smallSize * 4;
      const container = containerRef.current;
      const smallPattern = smallPatternRef.current;
      const largePattern = largePatternRef.current;
      const smallPath = smallPathRef.current;
      const largePath = largePathRef.current;

      if (
        !container ||
        !smallPattern ||
        !largePattern ||
        !smallPath ||
        !largePath
      )
        return;

      container.style.setProperty("--pilo-grid-small-size", `${smallSize}px`);
      container.style.setProperty("--pilo-grid-large-size", `${largeSize}px`);

      smallPattern.setAttribute("width", String(smallSize));
      smallPattern.setAttribute("height", String(smallSize));
      smallPattern.setAttribute(
        "x",
        String(toGridOffset(camera.x, smallSize, camera.z)),
      );
      smallPattern.setAttribute(
        "y",
        String(toGridOffset(camera.y, smallSize, camera.z)),
      );
      smallPath.setAttribute("d", `M ${smallSize} 0 L 0 0 0 ${smallSize}`);

      largePattern.setAttribute("width", String(largeSize));
      largePattern.setAttribute("height", String(largeSize));
      largePattern.setAttribute(
        "x",
        String(toGridOffset(camera.x, largeSize, camera.z)),
      );
      largePattern.setAttribute(
        "y",
        String(toGridOffset(camera.y, largeSize, camera.z)),
      );
      largePath.setAttribute("d", `M ${largeSize} 0 L 0 0 0 ${largeSize}`);
    },
    [editor],
  );

  return (
    <div ref={containerRef} className="pilo-canvas-background">
      <svg className="pilo-canvas-grid" aria-hidden="true">
        <defs>
          <pattern
            ref={smallPatternRef}
            id={smallGridId}
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
            x="0"
            y="0"
          >
            <path
              ref={smallPathRef}
              d="M 32 0 L 0 0 0 32"
              fill="none"
              stroke="rgba(15, 20, 34, 0.045)"
              strokeWidth="1"
            />
          </pattern>
          <pattern
            ref={largePatternRef}
            id={largeGridId}
            width="128"
            height="128"
            patternUnits="userSpaceOnUse"
            x="0"
            y="0"
          >
            <path
              ref={largePathRef}
              d="M 128 0 L 0 0 0 128"
              fill="none"
              stroke="rgba(109, 91, 214, 0.09)"
              strokeWidth="1.2"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${smallGridId})`} />
        <rect width="100%" height="100%" fill={`url(#${largeGridId})`} />
      </svg>
    </div>
  );
}
