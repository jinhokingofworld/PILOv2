"use client";

import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useValue } from "@tldraw/state-react";
import { HTMLContainer, useEditor } from "tldraw";
import {
  piloCodeLanguages,
  type PiloCodeBlockShape,
  type PiloCodeBlockShapeProps,
  type PiloCodeLanguage,
} from "./PiloCodeBlockShapeTypes";
import {
  PiloCodeMirrorEditor,
  type CodeScrollAnchor,
} from "./PiloCodeMirrorEditor";

export function PiloCodeBlockComponent({
  shape,
}: {
  shape: PiloCodeBlockShape;
}) {
  const editor = useEditor();
  const scrollAnchorRef = useRef<CodeScrollAnchor | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const isEditing = useValue(
    "pilo-code-block-editing",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  );

  function updateProps(props: Partial<PiloCodeBlockShapeProps>) {
    editor.updateShapes([
      {
        id: shape.id,
        type: shape.type,
        props,
      },
    ]);
  }

  function updateScrollY(scrollY: number, anchor: CodeScrollAnchor) {
    scrollAnchorRef.current = anchor;
    const nextScrollY = Math.max(0, scrollY);

    if (Math.abs(nextScrollY - (shape.props.scrollY ?? 0)) < 0.5) return;

    editor.run(
      () => {
        editor.updateShapes([
          {
            id: shape.id,
            type: shape.type,
            props: {
              scrollY: nextScrollY,
            },
          },
        ]);
      },
      { history: "ignore" },
    );
  }

  function handleEditorPointerDown(event: PointerEvent<HTMLElement>) {
    editor.markEventAsHandled(event);
    event.stopPropagation();
  }

  function handleMoveHandlePointerDown(event: PointerEvent<HTMLElement>) {
    if (isEditing || event.button !== 0) return;

    editor.setCurrentTool("select");
    editor.select(shape.id);
    editor.focus();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(shape.props.code);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1200);
    } catch (error) {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1200);
    }
  }

  return (
    <HTMLContainer
      className={`pilo-code-block-shape${isEditing ? " is-editing" : ""}`}
      style={{
        width: shape.props.w,
        height: shape.props.h,
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        editor.setEditingShape(shape.id);
      }}
    >
      <article className="pilo-code-block">
        <header onPointerDownCapture={handleMoveHandlePointerDown}>
          <span className="pilo-code-dot is-red" />
          <span className="pilo-code-dot is-yellow" />
          <span className="pilo-code-dot is-green" />
          {isEditing ? (
            <>
              <input
                aria-label="파일명"
                value={shape.props.fileName}
                onChange={(event) =>
                  updateProps({ fileName: event.target.value })
                }
                onPointerDown={handleEditorPointerDown}
              />
              <select
                aria-label="코드 언어"
                value={shape.props.language}
                onChange={(event) =>
                  updateProps({
                    language: event.target.value as PiloCodeLanguage,
                  })
                }
                onPointerDown={handleEditorPointerDown}
              >
                {piloCodeLanguages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <strong>{shape.props.fileName || "untitled.tsx"}</strong>
              <small>{shape.props.language}</small>
              <button
                type="button"
                className="pilo-code-copy-button"
                aria-label="코드 복사"
                onClick={(event) => {
                  event.stopPropagation();
                  void copyCode();
                }}
                onPointerDown={handleEditorPointerDown}
              >
                {copyState === "copied"
                  ? "복사됨"
                  : copyState === "failed"
                    ? "실패"
                    : "복사"}
              </button>
            </>
          )}
        </header>
        {isEditing ? (
          <div className="pilo-code-editor">
            <PiloCodeMirrorEditor
              code={shape.props.code}
              language={shape.props.language}
              mode="edit"
              scrollY={shape.props.scrollY ?? 0}
              scrollAnchor={scrollAnchorRef.current}
              onCodeChange={(code) => updateProps({ code })}
              onEscape={() => editor.setEditingShape(null)}
              onPointerDown={handleEditorPointerDown}
              onScrollYChange={updateScrollY}
            />
          </div>
        ) : (
          <div className="pilo-code-editor">
            <PiloCodeMirrorEditor
              code={shape.props.code}
              language={shape.props.language}
              mode="view"
              scrollY={shape.props.scrollY ?? 0}
              scrollAnchor={scrollAnchorRef.current}
              onScrollYChange={updateScrollY}
            />
          </div>
        )}
      </article>
    </HTMLContainer>
  );
}
