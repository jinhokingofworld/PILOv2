"use client";

import { useEffect, useRef } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
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
  syntaxHighlighting
} from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from "@codemirror/view";

type PrReviewResolvedCodeEditorProps = {
  filePath: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  value: string;
};

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "13px"
  },
  ".cm-scroller": {
    overflow: "auto",
    lineHeight: "1.65"
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "12px 0"
  },
  ".cm-line": {
    padding: "0 16px"
  },
  ".cm-gutters": {
    borderRight: "1px solid #e2e8f0",
    backgroundColor: "#f8fafc",
    color: "#94a3b8"
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "52px",
    padding: "0 12px 0 8px"
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "#eff6ff"
  },
  ".cm-selectionBackground": {
    backgroundColor: "#bfdbfe !important"
  },
  ".cm-focused": {
    outline: "none"
  }
});

function getLanguageExtension(filePath: string): Extension {
  const extension = filePath.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "ts":
      return javascript({ typescript: true });
    case "jsx":
      return javascript({ jsx: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "json":
      return json();
    case "css":
    case "scss":
      return css();
    case "html":
      return html();
    case "md":
    case "mdx":
      return markdown();
    case "sql":
      return sql();
    case "py":
      return python();
    case "c":
    case "cc":
    case "cpp":
    case "h":
    case "hpp":
      return cpp();
    default:
      return [];
  }
}

export function PrReviewResolvedCodeEditor({
  filePath,
  onChange,
  readOnly,
  value
}: PrReviewResolvedCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const isApplyingExternalValueRef = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          getLanguageExtension(filePath),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          editorTheme,
          readOnlyCompartmentRef.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly)
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || isApplyingExternalValueRef.current) {
              return;
            }

            onChangeRef.current(update.state.doc.toString());
          })
        ]
      })
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [filePath]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) {
      return;
    }

    isApplyingExternalValueRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        insert: value,
        to: view.state.doc.length
      }
    });
    isApplyingExternalValueRef.current = false;
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly)
      ])
    });
  }, [readOnly]);

  return (
    <div
      aria-label="최종 해결 코드 편집기"
      className="min-h-0 flex-1 overflow-hidden bg-white"
      ref={containerRef}
    />
  );
}
