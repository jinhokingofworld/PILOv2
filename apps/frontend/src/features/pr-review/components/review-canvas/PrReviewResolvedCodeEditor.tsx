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
import {
  Compartment,
  EditorState,
  type Extension,
  type Range
} from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from "@codemirror/view";

type PrReviewResolvedCodeEditorProps = {
  changedLineNumbers: number[];
  filePath: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  revealLine: number | null;
  revealRequestId: number;
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
  ".cm-resolvedChangedLine": {
    backgroundColor: "#ecfdf5",
    boxShadow: "inset 3px 0 0 #10b981"
  },
  ".cm-conflictMarkerLine": {
    backgroundColor: "#fff7ed",
    boxShadow: "inset 3px 0 0 #f97316",
    color: "#9a3412",
    fontWeight: "700"
  },
  ".cm-selectionBackground": {
    backgroundColor: "#bfdbfe !important"
  },
  ".cm-focused": {
    outline: "none"
  }
});

function buildChangedLineHighlightExtension(changedLineNumbers: number[]) {
  const uniqueLineNumbers = [...new Set(changedLineNumbers)].sort(
    (left, right) => left - right
  );

  return EditorView.decorations.compute(["doc"], (state) =>
    Decoration.set(
      uniqueLineNumbers.flatMap((lineNumber) => {
        if (lineNumber < 1 || lineNumber > state.doc.lines) {
          return [];
        }

        return [
          Decoration.line({ class: "cm-resolvedChangedLine" }).range(
            state.doc.line(lineNumber).from
          )
        ];
      })
    )
  );
}

function buildConflictMarkerHighlightExtension() {
  return EditorView.decorations.compute(["doc"], (state) => {
    const decorations: Array<Range<Decoration>> = [];

    for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      if (/^\s*(<<<<<<<|=======|>>>>>>>)/.test(line.text)) {
        decorations.push(
          Decoration.line({ class: "cm-conflictMarkerLine" }).range(line.from)
        );
      }
    }

    return Decoration.set(decorations);
  });
}

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
  changedLineNumbers,
  filePath,
  onChange,
  readOnly,
  revealLine,
  revealRequestId,
  value
}: PrReviewResolvedCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const changedLinesCompartmentRef = useRef(new Compartment());
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
          changedLinesCompartmentRef.current.of(
            buildChangedLineHighlightExtension(changedLineNumbers)
          ),
          buildConflictMarkerHighlightExtension(),
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

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: changedLinesCompartmentRef.current.reconfigure(
        buildChangedLineHighlightExtension(changedLineNumbers)
      )
    });
  }, [changedLineNumbers]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || revealLine === null) {
      return;
    }

    const lineNumber = Math.min(Math.max(revealLine, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      selection: { anchor: line.from }
    });
    view.focus();
  }, [revealLine, revealRequestId]);

  return (
    <div
      aria-label="최종 해결 코드 편집기"
      className="min-h-0 flex-1 overflow-hidden bg-white"
      ref={containerRef}
    />
  );
}
