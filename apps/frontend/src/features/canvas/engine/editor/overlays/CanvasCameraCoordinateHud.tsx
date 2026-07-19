"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { useValue } from "@tldraw/state-react";
import { useEditor } from "tldraw";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatCanvasCoordinatePoint } from "./canvas-coordinate-hud";

function formatDraftCoordinate(value: number) {
  return String(Math.round(value * 10) / 10);
}

export function CanvasCameraCoordinateHud() {
  const editor = useEditor();
  const cancelCloseRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [draftX, setDraftX] = useState("0");
  const [draftY, setDraftY] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const viewportCenter = useValue(
    "canvas-camera-coordinate-hud-center",
    () => {
      const viewport = editor.getViewportPageBounds();

      return {
        x: viewport.x + viewport.w / 2,
        y: viewport.y + viewport.h / 2,
      };
    },
    [editor],
  );

  function moveToDraftCoordinate() {
    const x = Number(draftX.trim());
    const y = Number(draftY.trim());

    if (!draftX.trim() || !draftY.trim() || !Number.isFinite(x) || !Number.isFinite(y)) {
      setError("올바른 좌표를 입력해 주세요.");
      return false;
    }

    editor.centerOnPoint(
      { x, y },
      {
        animation: { duration: 180 },
      },
    );
    setError(null);
    return true;
  }

  function handleOpenChange(open: boolean) {
    if (open) {
      setDraftX(formatDraftCoordinate(viewportCenter.x));
      setDraftY(formatDraftCoordinate(viewportCenter.y));
      setError(null);
      setIsOpen(true);
      return;
    }

    if (cancelCloseRef.current) {
      cancelCloseRef.current = false;
      setError(null);
      setIsOpen(false);
      return;
    }

    if (moveToDraftCoordinate()) {
      setIsOpen(false);
    }
  }

  function stopCanvasPointerEvent(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      cancelCloseRef.current = true;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (moveToDraftCoordinate()) {
      setIsOpen(false);
    }
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={isOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label="현재 Canvas 카메라 중심 좌표, 클릭하여 좌표로 이동"
            className="canvas-coordinate-hud"
            onPointerDown={stopCanvasPointerEvent}
            size="xs"
            title="좌표로 이동"
            type="button"
            variant="outline"
          />
        }
      >
        {formatCanvasCoordinatePoint(viewportCenter)}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-1.5"
        onKeyDownCapture={handleKeyDown}
        onPointerDown={stopCanvasPointerEvent}
        side="bottom"
      >
        <form className="flex items-center gap-1.5" onSubmit={handleSubmit}>
          <label className="flex items-center gap-1 text-xs font-medium">
            <span>X:</span>
            <Input
              aria-invalid={Boolean(error)}
              aria-label="이동할 Canvas X 좌표"
              autoFocus
              autoComplete="off"
              className="h-6 w-14 px-1.5 text-[10px] tabular-nums md:text-[10px]"
              inputMode="decimal"
              onChange={(event) => {
                setDraftX(event.target.value);
                setError(null);
              }}
              spellCheck={false}
              type="text"
              value={draftX}
            />
          </label>
          <label className="flex items-center gap-1 text-xs font-medium">
            <span>Y:</span>
            <Input
              aria-invalid={Boolean(error)}
              aria-label="이동할 Canvas Y 좌표"
              autoComplete="off"
              className="h-6 w-14 px-1.5 text-[10px] tabular-nums md:text-[10px]"
              inputMode="decimal"
              onChange={(event) => {
                setDraftY(event.target.value);
                setError(null);
              }}
              spellCheck={false}
              type="text"
              value={draftY}
            />
          </label>
          <button className="sr-only" type="submit">
            좌표로 이동
          </button>
        </form>
        {error ? (
          <p className="mt-1 text-[10px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
