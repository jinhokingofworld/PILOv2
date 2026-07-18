import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  client,
  editor,
  panel,
  types,
  editorStyles,
  attachment,
  picker,
  preview,
  slashMenu,
  bubbleMenu,
  blockHandle,
  inlineTitle,
  pdfCollaborationSurface
] = await Promise.all([
  readFile(new URL("./api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("./components/document-editor.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/drive-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("./types/index.ts", import.meta.url), "utf8"),
  readFile(new URL("./components/document-editor.module.css", import.meta.url), "utf8"),
  readFile(new URL("./components/document-file-attachment.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/document-file-picker.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/pdf-preview-dialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/document-slash-menu.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/document-bubble-menu.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/document-block-handle.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/document-inline-title.tsx", import.meta.url), "utf8"),
  readFile(new URL("./components/pdf-collaboration-surface.tsx", import.meta.url), "utf8")
]);

assert.match(types, /DriveItemType = "folder" \| "file" \| "document"/);
assert.match(types, /DocumentBootstrapPayload/);
assert.match(types, /SaveDocumentSnapshotInput/);
assert.match(types, /DrivePreviewUrlPayload/);
assert.match(
  types,
  /UpdateDriveItemInput =\s*\| \{ name: string \}\s*\| \{ parentId: string \| null \}/
);
assert.match(client, /async createDocument\(/);
assert.match(client, /async getDocument\(/);
assert.match(client, /async saveDocumentSnapshot\(/);
assert.match(client, /async createPreviewUrl\(/);
assert.match(client, /drive\/documents/);
assert.match(editor, /Collaboration\.configure/);
assert.match(editor, /CollaborationCaret\.configure/);
assert.match(editor, /StarterKit\.configure\(\{ undoRedo: false, dropcursor: false \}\)/);
assert.match(editor, /Dropcursor\.configure\(\{ color: "var\(--primary\)", width: 2 \}\)/);
assert.match(editor, /provider: realtimeProvider/);
assert.match(editor, /createDocumentRealtimeProvider/);
assert.match(editor, /createDocumentSnapshotSaveQueue/);
assert.match(editor, /yDoc\.on\("update"/);
assert.match(editor, /snapshotSaveQueue\.flush\(\)/);
assert.match(editor, /snapshotSaveQueue\.flush\(\)\.catch/);
assert.match(editor, /realtimeProvider\.flushPendingUpdates\(\)/);
assert.match(editor, /\}, \[yDoc\]\);/);
assert.match(editor, /DriveFileAttachment/);
assert.match(editor, /DocumentFilePicker/);
assert.match(editor, /DocumentSlashMenu/);
assert.match(editor, /DocumentBubbleMenu/);
assert.match(editor, /DocumentBlockHandle/);
assert.match(editor, /DocumentInlineTitle/);
assert.match(editor, /driveClient\.updateItem/);
assert.match(editor, /event\.key !== "\/"/);
assert.match(editor, /setHorizontalRule/);
assert.match(editor, /onSelectionUpdate: \(\) => closeSlashMenu\(\)/);
assert.match(editor, /Y\.encodeStateAsUpdate/);
assert.match(editor, /expectedVersion/);
assert.match(editor, /immediatelyRender: false/);
assert.match(editor, /styles\.documentPage/);
assert.match(editor, /styles\.documentHeader/);
assert.match(editor, /styles\.commandStrip/);
assert.match(editor, /styles\.editorSurface/);
assert.match(editor, /isEditorEmpty/);
assert.ok(editorStyles.includes("입력하려면 /"));
assert.doesNotMatch(editor, /rounded-md border bg-background/);
assert.match(editorStyles, /max-width: 60rem/);
assert.match(attachment, /driveFileAttachment/);
assert.match(attachment, /driveItemId/);
assert.match(attachment, /createDownloadUrl/);
assert.match(attachment, /PdfPreviewDialog/);
assert.ok(attachment.includes("사용할 수 없는 파일"));
assert.match(picker, /itemType === "file"/);
assert.match(picker, /uploadStatus === "ready"/);
assert.match(preview, /previewUrl/);
assert.match(preview, /createPreviewUrl/);
assert.match(preview, /PdfCollaborationSurface/);
assert.match(preview, /pdf-collaboration/);
assert.match(preview, /h-dvh/);
assert.match(preview, /w-dvw/);
assert.match(pdfCollaborationSurface, /PDF_STROKE_COLORS/);
assert.match(pdfCollaborationSurface, /erasedStrokeIdsRef/);
assert.match(pdfCollaborationSurface, /ArrowLeft/);
assert.match(pdfCollaborationSurface, /ArrowRight/);
assert.match(slashMenu, /role="listbox"/);
assert.match(slashMenu, /filterSlashCommands/);
assert.match(slashMenu, /query/);
assert.match(slashMenu, /autoFocus/);
assert.match(slashMenu, /onQueryChange/);
assert.match(slashMenu, /event\.nativeEvent\.isComposing/);
assert.doesNotMatch(slashMenu, /useMemo/);
assert.match(bubbleMenu, /BubbleMenu/);
assert.match(bubbleMenu, /toggleBold/);
assert.match(bubbleMenu, /toggleItalic/);
assert.match(blockHandle, /moveBlock/);
assert.match(blockHandle, /duplicateBlock/);
assert.match(blockHandle, /deleteBlock/);
assert.match(blockHandle, /DragHandle/);
assert.match(blockHandle, /nested=/);
assert.match(blockHandle, /allowedContainers: \["bulletList", "orderedList"\]/);
assert.match(blockHandle, /setMeta\("lockDragHandle", isMenuOpen\)/);
assert.match(blockHandle, /getReferencedVirtualElement/);
assert.match(blockHandle, /getBoundingClientRect/);
assert.match(blockHandle, /paddingLeft/);
assert.match(blockHandle, /strategy: "fixed"/);
assert.doesNotMatch(blockHandle, /commands\.lockDragHandle/);
assert.doesNotMatch(blockHandle, /commands\.unlockDragHandle/);
assert.match(inlineTitle, /onSave/);
assert.match(inlineTitle, /onBlur/);
assert.match(panel, /documentId/);
assert.match(panel, /DriveDocumentEditor/);
assert.match(panel, /PdfPreviewDialog/);
assert.match(
  panel,
  /const isPdf = item\.itemType === "file" && item\.mimeType === "application\/pdf"/
);
assert.match(panel, /onOpenPdf: \(item: DriveItem\) => void/);
assert.match(panel, /onOpenPdf=\{setPreviewFile\}/);
assert.match(panel, /function MoveItemSheet\(/);
assert.match(panel, /onOpenMove/);
assert.match(
  panel,
  /await driveClient\.updateItem\(workspaceId, moveItem\.id, \{ parentId \}\)/
);
assert.match(panel, /destinationParentId: string \| null/);
assert.match(panel, /isDestinationReady: boolean/);
assert.match(panel, /hasDestinationError: boolean/);
assert.match(panel, /onRetry: \(\) => void/);

console.log("Drive document contract tests passed.");
