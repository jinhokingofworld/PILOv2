"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  BaseFrameLikeShapeUtil,
  Group2d,
  HTMLContainer,
  Rectangle2d,
  T,
  useEditor,
  type TLBaseShape,
  type TLResizeInfo,
} from "tldraw";
import { useValue } from "@tldraw/state-react";

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

type PiloCodeBlockShapeProps = {
  w: number;
  h: number;
  fileName: string;
  language: PiloCodeLanguage;
  code: string;
  scrollY?: number;
};

export type PiloCodeBlockShape = TLBaseShape<
  "pilo-code-block",
  PiloCodeBlockShapeProps
>;

type CodeScrollAnchor = {
  lineNumber: number;
  offset: number;
};

function getCodeMirrorLanguage(language: PiloCodeLanguage): Extension {
  switch (language) {
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "ts":
      return javascript({ typescript: true });
    case "jsx":
      return javascript({ jsx: true });
    case "js":
      return javascript();
    case "json":
      return json();
    case "css":
      return css();
    case "html":
      return html();
    case "md":
      return markdown();
    case "sql":
      return sql();
    case "py":
      return python();
    case "c":
      return cpp();
    default:
      return [];
  }
}

const piloCodeMirrorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "transparent",
      color: "#c8d3f5",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: "12px",
    },
    ".cm-scroller": {
      overflow: "auto",
      scrollbarWidth: "none",
      lineHeight: "1.6",
    },
    ".cm-scroller::-webkit-scrollbar": {
      display: "none",
    },
    ".cm-content": {
      minHeight: "100%",
      padding: "14px 16px 14px 0",
      caretColor: "#e2e8f0",
    },
    ".cm-line": {
      padding: "0 0 0 12px",
    },
    ".cm-gutters": {
      borderRight: "1px solid rgba(148, 163, 184, 0.12)",
      backgroundColor: "transparent",
      color: "#526072",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "42px",
      padding: "0 10px 0 0",
      textAlign: "right",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(96, 165, 250, 0.08)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(96, 165, 250, 0.08)",
      color: "#94a3b8",
    },
    ".cm-selectionBackground": {
      backgroundColor: "rgba(96, 165, 250, 0.35) !important",
    },
    ".cm-focused": {
      outline: "none",
    },
  },
  { dark: true },
);

function getScrollTopForAnchor(
  view: EditorView,
  scrollY: number,
  anchor?: CodeScrollAnchor | null,
) {
  if (!anchor) return Math.max(0, scrollY);

  const lineNumber = Math.min(
    Math.max(1, anchor.lineNumber),
    view.state.doc.lines,
  );
  const line = view.state.doc.line(lineNumber);
  const lineBlock = view.lineBlockAt(line.from);
  const offset = Math.min(anchor.offset, Math.max(0, lineBlock.height - 1));

  return Math.max(0, lineBlock.top + offset);
}

function getCodeScrollAnchor(view: EditorView): CodeScrollAnchor {
  const lineBlock = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  const line = view.state.doc.lineAt(lineBlock.from);

  return {
    lineNumber: line.number,
    offset: 0,
  };
}

function PiloCodeMirrorEditor({
  code,
  language,
  mode,
  scrollY = 0,
  scrollAnchor,
  onCodeChange,
  onEscape,
  onPointerDown,
  onScrollYChange,
}: {
  code: string;
  language: PiloCodeLanguage;
  mode: "edit" | "view";
  scrollY?: number;
  scrollAnchor?: CodeScrollAnchor | null;
  onCodeChange?: (code: string) => void;
  onEscape?: () => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onScrollYChange?: (scrollY: number, anchor: CodeScrollAnchor) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const modeCompartmentRef = useRef<Compartment | null>(null);
  const onCodeChangeRef = useRef(onCodeChange);
  const onEscapeRef = useRef(onEscape);
  const onScrollYChangeRef = useRef(onScrollYChange);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollYRef = useRef(scrollY);
  const scrollAnchorRef = useRef(scrollAnchor);
  const modeRef = useRef(mode);
  const previousModeRef = useRef(mode);
  const isApplyingScrollRef = useRef(false);
  const isUserScrollRef = useRef(false);
  const suppressViewScrollSaveRef = useRef(false);
  const userScrollTimerRef = useRef<number | null>(null);
  const suppressViewScrollSaveTimerRef = useRef<number | null>(null);
  const releaseScrollLockTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onCodeChangeRef.current = onCodeChange;
  }, [onCodeChange]);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    onScrollYChangeRef.current = onScrollYChange;
  }, [onScrollYChange]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    scrollYRef.current = scrollY;
  }, [scrollY]);

  useEffect(() => {
    scrollAnchorRef.current = scrollAnchor;
  }, [scrollAnchor]);

  function reportCurrentScrollPosition(force = false) {
    const view = viewRef.current;

    if (!view) return;
    if (
      modeRef.current === "view" &&
      suppressViewScrollSaveRef.current &&
      !force
    ) {
      return;
    }

    const nextScrollY = view.scrollDOM.scrollTop;
    const nextAnchor = getCodeScrollAnchor(view);

    if (!force && Math.abs(nextScrollY - scrollYRef.current) < 0.5) return;

    onScrollYChangeRef.current?.(nextScrollY, nextAnchor);
  }

  function suppressViewScrollSave() {
    suppressViewScrollSaveRef.current = true;

    if (suppressViewScrollSaveTimerRef.current !== null) {
      window.clearTimeout(suppressViewScrollSaveTimerRef.current);
    }

    suppressViewScrollSaveTimerRef.current = window.setTimeout(() => {
      suppressViewScrollSaveTimerRef.current = null;
      suppressViewScrollSaveRef.current = false;
    }, 300);
  }

  function handleViewModeMouseEvent(event: { preventDefault: () => void }) {
    if (modeRef.current !== "view") return false;

    event.preventDefault();
    suppressViewScrollSave();
    return true;
  }

  function getModeExtensions(currentMode: "edit" | "view") {
    return currentMode === "edit"
      ? [
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;

            onCodeChangeRef.current?.(update.state.doc.toString());
          }),
          keymap.of([
            {
              key: "Escape",
              run() {
                onEscapeRef.current?.();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
        ]
      : [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ];
  }

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    function releaseScrollLock() {
      if (releaseScrollLockTimerRef.current !== null) {
        window.clearTimeout(releaseScrollLockTimerRef.current);
      }

      releaseScrollLockTimerRef.current = window.setTimeout(() => {
        releaseScrollLockTimerRef.current = null;
        isApplyingScrollRef.current = false;
      }, 180);
    }

    function applyScrollY(view: EditorView, nextScrollY: number) {
      const nextTop = getScrollTopForAnchor(
        view,
        nextScrollY,
        scrollAnchorRef.current,
      );

      if (Math.abs(view.scrollDOM.scrollTop - nextTop) < 0.5) return;

      isApplyingScrollRef.current = true;
      view.scrollDOM.scrollTop = nextTop;
      releaseScrollLock();
    }

    function reportScrollPosition(view: EditorView, force = false) {
      reportCurrentScrollPosition(force);
    }

    const modeCompartment = new Compartment();
    modeCompartmentRef.current = modeCompartment;

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          getCodeMirrorLanguage(language),
          EditorView.lineWrapping,
          piloCodeMirrorTheme,
          modeCompartment.of(getModeExtensions(mode)),
        ],
      }),
    });

    viewRef.current = view;
    const handleScroll = () => {
      if (isApplyingScrollRef.current) return;
      if (scrollFrameRef.current !== null) return;

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        reportScrollPosition(view);
      });
    };

    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

    window.requestAnimationFrame(() => {
      isApplyingScrollRef.current = true;

      if (mode === "edit") {
        view.focus();
      }

      window.requestAnimationFrame(() => {
        applyScrollY(view, scrollYRef.current);
        releaseScrollLock();
      });
    });

    return () => {
      if (modeRef.current === "edit" || isUserScrollRef.current) {
        reportCurrentScrollPosition(true);
      }

      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }

      if (releaseScrollLockTimerRef.current !== null) {
        window.clearTimeout(releaseScrollLockTimerRef.current);
        releaseScrollLockTimerRef.current = null;
      }

      if (userScrollTimerRef.current !== null) {
        window.clearTimeout(userScrollTimerRef.current);
        userScrollTimerRef.current = null;
      }

      if (suppressViewScrollSaveTimerRef.current !== null) {
        window.clearTimeout(suppressViewScrollSaveTimerRef.current);
        suppressViewScrollSaveTimerRef.current = null;
      }

      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
      viewRef.current = null;
      modeCompartmentRef.current = null;
    };
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    const modeCompartment = modeCompartmentRef.current;

    if (!view || !modeCompartment) return;

    const previousMode = previousModeRef.current;
    const currentScrollTop = view.scrollDOM.scrollTop;

    if (previousMode === "edit" && mode === "view") {
      reportCurrentScrollPosition(true);
    }

    isApplyingScrollRef.current = true;
    view.dispatch({
      effects: modeCompartment.reconfigure(getModeExtensions(mode)),
    });

    window.requestAnimationFrame(() => {
      if (mode === "edit") {
        view.focus();
      }

      view.scrollDOM.scrollTop = currentScrollTop;

      if (releaseScrollLockTimerRef.current !== null) {
        window.clearTimeout(releaseScrollLockTimerRef.current);
      }

      releaseScrollLockTimerRef.current = window.setTimeout(() => {
        releaseScrollLockTimerRef.current = null;
        isApplyingScrollRef.current = false;
      }, 180);
    });

    previousModeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) return;

    const currentCode = view.state.doc.toString();

    if (currentCode === code) return;

    view.dispatch({
      changes: {
        from: 0,
        to: currentCode.length,
        insert: code,
      },
    });
  }, [code]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) return;

    window.requestAnimationFrame(() => {
      const nextTop = getScrollTopForAnchor(
        view,
        scrollY,
        scrollAnchorRef.current,
      );

      if (Math.abs(view.scrollDOM.scrollTop - nextTop) < 0.5) return;

      isApplyingScrollRef.current = true;
      view.scrollDOM.scrollTop = nextTop;

      if (releaseScrollLockTimerRef.current !== null) {
        window.clearTimeout(releaseScrollLockTimerRef.current);
      }

      releaseScrollLockTimerRef.current = window.setTimeout(() => {
        releaseScrollLockTimerRef.current = null;
        isApplyingScrollRef.current = false;
      }, 180);
    });
  }, [scrollY, scrollAnchor]);

  return (
    <div
      className={`pilo-code-mirror is-${mode}`}
      ref={containerRef}
      onPointerDownCapture={(event) => {
        if (handleViewModeMouseEvent(event)) {
          return;
        }

        onPointerDown?.(event);
      }}
      onMouseDownCapture={(event) => {
        handleViewModeMouseEvent(event);
      }}
      onClickCapture={(event) => {
        handleViewModeMouseEvent(event);
      }}
      onWheelCapture={(event) => {
        isUserScrollRef.current = true;

        if (userScrollTimerRef.current !== null) {
          window.clearTimeout(userScrollTimerRef.current);
        }

        userScrollTimerRef.current = window.setTimeout(() => {
          userScrollTimerRef.current = null;
          isUserScrollRef.current = false;
        }, 300);

        event.stopPropagation();
      }}
    />
  );
}

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "pilo-code-block": PiloCodeBlockShapeProps;
  }
}

function PiloCodeBlockComponent({ shape }: { shape: PiloCodeBlockShape }) {
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

export class PiloCodeBlockShapeUtil extends BaseFrameLikeShapeUtil<PiloCodeBlockShape> {
  static override type = "pilo-code-block" as const;

  static override props = {
    w: T.number,
    h: T.number,
    fileName: T.string,
    language: T.literalEnum(
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
    ),
    code: T.string,
    scrollY: T.number.optional(),
  };

  override canEdit() {
    return true;
  }

  override getDefaultProps(): PiloCodeBlockShape["props"] {
    return {
      w: 420,
      h: 260,
      fileName: "canvas-node.tsx",
      language: "tsx",
      code: "export function CanvasNode() {\n  return <div>PILO</div>;\n}",
      scrollY: 0,
    };
  }

  override getGeometry(shape: PiloCodeBlockShape) {
    return new Group2d({
      children: [
        new Rectangle2d({
          width: shape.props.w,
          height: shape.props.h,
          isFilled: true,
        }),
      ],
    });
  }

  override onResize(
    _shape: PiloCodeBlockShape,
    info: TLResizeInfo<PiloCodeBlockShape>,
  ) {
    return {
      props: {
        w: Math.max(300, info.initialShape.props.w * Math.abs(info.scaleX)),
        h: Math.max(190, info.initialShape.props.h * Math.abs(info.scaleY)),
      },
    };
  }

  override component(shape: PiloCodeBlockShape) {
    return <PiloCodeBlockComponent shape={shape} />;
  }

  override getIndicatorPath(shape: PiloCodeBlockShape) {
    const path = new Path2D();

    path.rect(0, 0, shape.props.w, shape.props.h);

    return path;
  }
}
