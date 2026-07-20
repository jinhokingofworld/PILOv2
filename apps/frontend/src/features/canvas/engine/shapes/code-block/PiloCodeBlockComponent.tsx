"use client";

import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useValue } from "@tldraw/state-react";
import { HTMLContainer, useEditor } from "tldraw";
import {
  useCanvasRemoteShapeEditingPresence,
  useCanvasRemoteShapePresence,
} from "@/features/canvas/collaboration/CanvasRemotePresenceContext";
import {
  PILO_COLLAPSED_CODE_BLOCK_SIZE,
  piloCodeLanguages,
  type PiloCodeBlockShape,
  type PiloCodeBlockShapeProps,
  type PiloCodeLanguage,
} from "./PiloCodeBlockShapeTypes";
import {
  PiloCodeMirrorEditor,
  type CodeScrollAnchor,
} from "./PiloCodeMirrorEditor";
import {
  PILO_CODE_BLOCK_COLLAPSED_META_KEY,
  PILO_CODE_BLOCK_EXPANDED_SIZE_META_KEY,
  getCodeLineCount,
  getCodePreview,
  getPiloCodeBlockExpandedSize,
  isPiloCodeBlockCollapsed,
} from "../canvas-shape-metadata";
import { isPiloCodeBlockShape } from "../PiloCanvasShapeGuards";

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
  const isCollapsed = isPiloCodeBlockCollapsed(shape);
  const lineCount = getCodeLineCount(shape.props.code);
  const preview = getCodePreview(shape.props.code);
  const remoteShapePresence = useCanvasRemoteShapePresence(String(shape.id));
  const remoteShapeEditingPresence = useCanvasRemoteShapeEditingPresence(
    String(shape.id),
  );
  const remoteShapePresenceLabel =
    remoteShapePresence.length > 1
      ? `${remoteShapePresence.length}명 선택 중`
      : remoteShapePresence[0]
        ? `${remoteShapePresence[0].displayName || "다른 사용자"} 선택 중`
        : null;
  const remoteShapeEditingLabel =
    remoteShapeEditingPresence.length > 1
      ? `${remoteShapeEditingPresence.length} users editing`
      : remoteShapeEditingPresence[0]
        ? `${remoteShapeEditingPresence[0].displayName || "Another user"} editing`
        : null;
  const isEditing = useValue(
    "pilo-code-block-editing",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  );

  function updateProps(props: Partial<PiloCodeBlockShapeProps>) {
    const currentShape = editor.getShape(shape.id);

    if (!isPiloCodeBlockShape(currentShape)) return;

    editor.updateShapes([
      {
        id: currentShape.id,
        type: currentShape.type,
        props,
      },
    ]);
  }

  function toggleCollapsed(event: PointerEvent<HTMLButtonElement>) {
    const currentShape = editor.getShape(shape.id);

    if (!isPiloCodeBlockShape(currentShape)) return;

    const nextCollapsed = !isPiloCodeBlockCollapsed(currentShape);
    const expandedSize = getPiloCodeBlockExpandedSize(currentShape);
    const currentSize = {
      h: currentShape.props.h,
      w: currentShape.props.w,
    };
    const nextSize = nextCollapsed
      ? PILO_COLLAPSED_CODE_BLOCK_SIZE
      : expandedSize ?? undefined;

    editor.markEventAsHandled(event);
    event.stopPropagation();
    editor.updateShapes([
      {
        id: currentShape.id,
        type: currentShape.type,
        props: {
          isCollapsed: nextCollapsed,
          ...(nextSize ?? {}),
        },
        meta: {
          ...(currentShape.meta ?? {}),
          [PILO_CODE_BLOCK_COLLAPSED_META_KEY]: nextCollapsed,
          ...(nextCollapsed
            ? {
                [PILO_CODE_BLOCK_EXPANDED_SIZE_META_KEY]: currentSize,
              }
            : {}),
        },
      },
    ]);

    if (nextCollapsed && isEditing) {
      editor.setEditingShape(null);
    }
  }

  function updateScrollY(scrollY: number, anchor: CodeScrollAnchor) {
    scrollAnchorRef.current = anchor;
    const currentShape = editor.getShape(shape.id);

    if (!isPiloCodeBlockShape(currentShape)) return;

    const nextScrollY = Math.max(0, scrollY);

    if (Math.abs(nextScrollY - (currentShape.props.scrollY ?? 0)) < 0.5) return;

    editor.run(
      () => {
        const shapeToUpdate = editor.getShape(currentShape.id);

        if (!isPiloCodeBlockShape(shapeToUpdate)) return;

        editor.updateShapes([
          {
            id: shapeToUpdate.id,
            type: shapeToUpdate.type,
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
      className={`pilo-code-block-shape${isEditing ? " is-editing" : ""}${isCollapsed ? " is-collapsed" : ""}${remoteShapePresenceLabel ? " is-remotely-selected" : ""}${remoteShapeEditingLabel ? " is-remotely-editing" : ""}`}
      style={{
        width: shape.props.w,
        height: shape.props.h,
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (isPiloCodeBlockShape(editor.getShape(shape.id))) {
          editor.setEditingShape(shape.id);
        }
      }}
    >
      <article className="pilo-code-block">
        <header onPointerDownCapture={handleMoveHandlePointerDown}>
          <span className="pilo-code-dot is-red" />
          <span className="pilo-code-dot is-yellow" />
          <span className="pilo-code-dot is-green" />
          {remoteShapePresenceLabel ? (
            <span
              className="pilo-code-remote-presence-badge"
              title="현재 realtime 계약은 선택 상태만 전달하므로 실제 텍스트 편집 여부는 표시하지 않습니다."
            >
              {remoteShapePresenceLabel}
            </span>
          ) : null}
          {remoteShapeEditingLabel ? (
            <span
              className="pilo-code-remote-edit-badge"
              title="다른 사용자가 이 코드 블록을 편집 중입니다. 변경사항은 서버 수신 순서대로 반영됩니다."
            >
              {remoteShapeEditingLabel}
            </span>
          ) : null}
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
                className="pilo-code-collapse-button"
                aria-label={isCollapsed ? "코드 블록 펼치기" : "코드 블록 접기"}
                onClick={toggleCollapsed}
                onPointerDown={handleEditorPointerDown}
              >
                {isCollapsed ? "펼치기" : "접기"}
              </button>
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
        ) : isCollapsed ? (
          <div className="pilo-code-preview">
            <div>
              <span>{shape.props.language}</span>
              <span>{lineCount} lines</span>
            </div>
            <pre>{preview || " "}</pre>
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
