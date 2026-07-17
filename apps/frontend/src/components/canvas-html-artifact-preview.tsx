"use client";

import { Check, Copy, Eye } from "lucide-react";
import { useEffect, useState } from "react";

export type CanvasHtmlArtifact = {
  kind: "html";
  title: string;
  html: string;
  sourceShapeIds: string[];
};

export function CanvasHtmlArtifactPreview({ artifact }: { artifact: CanvasHtmlArtifact }) {
  const [copied, setCopied] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  useEffect(() => {
    setCopied(false);
    setPreviewVisible(false);
  }, [artifact.html]);

  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(artifact.html);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-slate-700">
      <strong className="block text-sm text-slate-950">{artifact.title}</strong>
      <span className="mt-1 block text-slate-500">
        정적 HTML/CSS 초안 · {artifact.sourceShapeIds.length}개 도형
      </span>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-1.5 font-medium text-white"
          onClick={() => void copyHtml()}
          type="button"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "복사됨" : "HTML 복사"}
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700"
          onClick={() => setPreviewVisible((visible) => !visible)}
          type="button"
        >
          <Eye className="size-3.5" />
          {previewVisible ? "미리보기 닫기" : "미리보기"}
        </button>
      </div>
      {previewVisible ? (
        <iframe
          className="mt-3 aspect-[16/10] min-h-52 w-full rounded-lg border border-slate-200 bg-white"
          sandbox=""
          srcDoc={buildSandboxedPreviewDocument(artifact.html)}
          title={`${artifact.title} 미리보기`}
        />
      ) : null}
    </div>
  );
}

function buildSandboxedPreviewDocument(html: string) {
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`);
  }
  return /<html(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${meta}</head>`)
    : `<html><head>${meta}</head><body>${html}</body></html>`;
}
