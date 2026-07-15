"use client";

import type {
  PointerEventHandler,
  ReactNode,
  WheelEventHandler,
} from "react";
import { Tldraw, type TldrawProps } from "tldraw";

export type TldrawSurfaceProps = {
  children?: ReactNode;
  className?: string;
  components?: TldrawProps["components"];
  hideUi?: TldrawProps["hideUi"];
  licenseKey?: TldrawProps["licenseKey"];
  onMount?: TldrawProps["onMount"];
  onPointerDownCapture?: PointerEventHandler<HTMLDivElement>;
  onWheelCapture?: WheelEventHandler<HTMLDivElement>;
  shapeUtils?: TldrawProps["shapeUtils"];
  store?: TldrawProps["store"];
};

export function TldrawSurface({
  children,
  className,
  components,
  hideUi = true,
  licenseKey,
  onMount,
  onPointerDownCapture,
  onWheelCapture,
  shapeUtils,
  store,
}: TldrawSurfaceProps) {
  return (
    <div
      className={className}
      onPointerDownCapture={onPointerDownCapture}
      onWheelCapture={onWheelCapture}
    >
      <Tldraw
        hideUi={hideUi}
        licenseKey={licenseKey}
        shapeUtils={shapeUtils}
        store={store}
        components={components}
        onMount={onMount}
      >
        {children}
      </Tldraw>
    </div>
  );
}
