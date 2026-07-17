"use client";

import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Dropcursor from "@tiptap/extension-dropcursor";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlertCircle,
  ArrowLeft,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Loader2,
  Paperclip,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  Undo2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuthSession } from "@/features/auth";
import {
  DriveApiError,
  createDriveApiClient
} from "@/features/drive/api/client";
import type { DocumentBootstrapPayload } from "@/features/drive/types";

import {
  createDocumentCollaborator,
  createDocumentRealtimeProvider,
  createDocumentSnapshotSaveQueue,
  getDocumentRealtimeServerUrl,
  shouldUseDocumentSnapshotFallback
} from "../document-realtime";
import styles from "./document-editor.module.css";
import { DocumentBlockHandle } from "./document-block-handle";
import { DocumentBubbleMenu } from "./document-bubble-menu";
import { DriveFileAttachment } from "./document-file-attachment";
import { DocumentFilePicker } from "./document-file-picker";
import { DocumentInlineTitle } from "./document-inline-title";
import {
  DocumentSlashMenu
} from "./document-slash-menu";
import {
  type SlashCommandId
} from "./document-slash-commands";

type EditorLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bootstrap: DocumentBootstrapPayload };

type SaveState = "saved" | "saving" | "error" | "conflict";
type RealtimeState = "connected" | "connecting" | "disabled" | "disconnected";

type SlashMenuState = {
  position: { top: number; left: number };
  activeIndex: number;
  query: string;
};

type PendingSnapshot = {
  contentJson: Record<string, unknown>;
  yjsState: string;
};

const DOCUMENT_SNAPSHOT_AUTOSAVE_DELAY_MS = 1000;
const SLASH_MENU_MAX_HEIGHT_PX = 384;

function messageFromUnknown(error: unknown) {
  return error instanceof Error
    ? error.message
    : "문서를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function fromBase64(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toBase64(bytes: Uint8Array) {
  const chunkSize = 8192;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return window.btoa(binary);
}

function ToolbarButton({
  active = false,
  label,
  onClick,
  children
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function DocumentEditorSurface({
  bootstrap,
  onReload,
  onClose
}: {
  bootstrap: DocumentBootstrapPayload;
  onReload: () => void;
  onClose: () => void;
}) {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const yDoc = useMemo(() => {
    const nextYDoc = new Y.Doc();
    Y.applyUpdate(nextYDoc, fromBase64(bootstrap.snapshot.yjsState));
    return nextYDoc;
  }, [bootstrap.snapshot.id, bootstrap.snapshot.yjsState]);
  const currentVersionRef = useRef(bootstrap.document.currentVersion);
  const editorRef = useRef<Editor | null>(null);
  const pendingSnapshotRef = useRef<PendingSnapshot | null>(null);
  const slashMenuStateRef = useRef<SlashMenuState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
  const [isEditorEmpty, setIsEditorEmpty] = useState(false);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState | null>(null);
  const [documentName, setDocumentName] = useState(bootstrap.item.name);
  const [realtimeProvider, setRealtimeProvider] =
    useState<ReturnType<typeof createDocumentRealtimeProvider>>(null);
  const currentCollaborator = useMemo(
    () =>
      createDocumentCollaborator({
        displayName: authSession?.user.displayName ?? authSession?.user.name ?? "",
        userId: authSession?.user.id ?? ""
      }),
    [authSession?.user.displayName, authSession?.user.id, authSession?.user.name]
  );
  const driveClient = useMemo(
    () => createDriveApiClient({ accessToken }),
    [accessToken]
  );
  const useSnapshotFallback = useMemo(
    () =>
      shouldUseDocumentSnapshotFallback(
        Boolean(accessToken && getDocumentRealtimeServerUrl())
      ),
    [accessToken]
  );

  useEffect(() => {
    currentVersionRef.current = bootstrap.document.currentVersion;
    setSaveState("saved");
    setSaveError(null);
  }, [bootstrap.document.currentVersion, bootstrap.snapshot.id]);

  useEffect(() => {
    setDocumentName(bootstrap.item.name);
  }, [bootstrap.item.id, bootstrap.item.name]);

  const renameDocument = useCallback(
    async (name: string) => {
      if (!workspaceId || !accessToken) {
        throw new Error("문서 이름을 변경하려면 로그인해야 합니다.");
      }

      if (name === "." || name === ".." || /[\\/]/.test(name)) {
        throw new Error("문서 이름에 사용할 수 없는 문자가 포함되어 있습니다.");
      }

      const item = await driveClient.updateItem(workspaceId, bootstrap.item.id, {
        name
      });
      setDocumentName(item.name);
    },
    [accessToken, bootstrap.item.id, driveClient, workspaceId]
  );

  const captureSnapshot = useCallback(
    (editor: Editor) => {
      pendingSnapshotRef.current = {
        contentJson: editor.getJSON() as Record<string, unknown>,
        yjsState: toBase64(Y.encodeStateAsUpdate(yDoc))
      };
    },
    [yDoc]
  );

  const persistSnapshot = useCallback(async () => {
    const pendingSnapshot = pendingSnapshotRef.current;
    if (!pendingSnapshot || !workspaceId || !accessToken) {
      return;
    }

    async function saveCurrentSnapshot(snapshot: PendingSnapshot) {
      return driveClient.saveDocumentSnapshot(workspaceId, bootstrap.document.id, {
        expectedVersion: currentVersionRef.current,
        yjsState: snapshot.yjsState,
        contentJson: snapshot.contentJson
      });
    }

    try {
      let result;

      try {
        result = await saveCurrentSnapshot(pendingSnapshot);
      } catch (error) {
        if (!(error instanceof DriveApiError) || error.status !== 409) {
          throw error;
        }

        const latest = await driveClient.getDocument(workspaceId, bootstrap.document.id);
        Y.applyUpdate(yDoc, fromBase64(latest.snapshot.yjsState));
        currentVersionRef.current = latest.document.currentVersion;
        const activeEditor = editorRef.current;
        if (!activeEditor) {
          throw error;
        }
        captureSnapshot(activeEditor);
        result = await saveCurrentSnapshot(pendingSnapshotRef.current!);
      }

      currentVersionRef.current = result.document.currentVersion;
      setSaveState("saved");
      setSaveError(null);
    } catch (error) {
      setSaveState("error");
      setSaveError(messageFromUnknown(error));
      throw error;
    }
  }, [accessToken, bootstrap.document.id, captureSnapshot, driveClient, workspaceId, yDoc]);

  const snapshotSaveQueue = useMemo(
    () =>
      createDocumentSnapshotSaveQueue({
        delayMs: DOCUMENT_SNAPSHOT_AUTOSAVE_DELAY_MS,
        save: persistSnapshot
      }),
    [persistSnapshot]
  );

  const retrySnapshot = useCallback(() => {
    if (!useSnapshotFallback) {
      return;
    }

    setSaveState("saving");
    setSaveError(null);
    snapshotSaveQueue.schedule();
    void snapshotSaveQueue.flush().catch(() => undefined);
  }, [snapshotSaveQueue, useSnapshotFallback]);

  const closeSlashMenu = useCallback(() => {
    slashMenuStateRef.current = null;
    setSlashMenuState(null);
  }, []);

  const setSlashMenuActiveIndex = useCallback((nextIndex: number) => {
    const currentState = slashMenuStateRef.current;
    if (!currentState) return;

    const nextState = { ...currentState, activeIndex: nextIndex };
    slashMenuStateRef.current = nextState;
    setSlashMenuState(nextState);
  }, []);

  const setSlashMenuQuery = useCallback((query: string) => {
    const currentState = slashMenuStateRef.current;
    if (!currentState) return;

    const nextState = { ...currentState, activeIndex: 0, query };
    slashMenuStateRef.current = nextState;
    setSlashMenuState(nextState);
  }, []);

  const handleEditorKeyDown = useCallback(
    (view: EditorView, event: KeyboardEvent) => {
      const { selection } = view.state;
      if (
        event.key !== "/" ||
        !selection.empty ||
        selection.$from.parent.type.name !== "paragraph" ||
        selection.$from.parent.content.size !== 0
      ) {
        return false;
      }

      event.preventDefault();
      const coordinates = view.coordsAtPos(selection.from);
      const availableMenuHeight = Math.min(
        SLASH_MENU_MAX_HEIGHT_PX,
        Math.max(0, window.innerHeight - 32)
      );
      const menuTopBelowCursor = coordinates.bottom + 8;
      const menuTop =
        menuTopBelowCursor + availableMenuHeight <= window.innerHeight - 16
          ? menuTopBelowCursor
          : Math.max(16, coordinates.top - 8 - availableMenuHeight);
      const nextState = {
        activeIndex: 0,
        query: "",
        position: {
          top: menuTop,
          left: Math.max(16, Math.min(coordinates.left, window.innerWidth - 336))
        }
      };
      slashMenuStateRef.current = nextState;
      setSlashMenuState(nextState);
      return true;
    },
    []
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false, dropcursor: false }),
      DriveFileAttachment,
      Collaboration.configure({ document: yDoc }),
      Dropcursor.configure({ color: "var(--primary)", width: 2 }),
      ...(realtimeProvider
        ? [
            CollaborationCaret.configure({
              provider: realtimeProvider,
              user: currentCollaborator
            })
          ]
        : [])
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "text-sm leading-7 outline-none sm:text-base"
      },
      handleKeyDown: handleEditorKeyDown
    },
    onCreate: ({ editor: createdEditor }) => setIsEditorEmpty(createdEditor.isEmpty),
    onUpdate: ({ editor: updatedEditor }) => {
      setIsEditorEmpty(updatedEditor.isEmpty);
      closeSlashMenu();
    },
    onSelectionUpdate: () => closeSlashMenu()
  }, [currentCollaborator, realtimeProvider, yDoc]);

  useEffect(() => {
    editorRef.current = editor;

    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor]);

  useEffect(() => {
    if (!useSnapshotFallback) {
      return;
    }

    let disposed = false;
    const handleUpdate = () => {
      queueMicrotask(() => {
        if (disposed || !editorRef.current) {
          return;
        }

        captureSnapshot(editorRef.current);
        setSaveState("saving");
        setSaveError(null);
        snapshotSaveQueue.schedule();
      });
    };

    yDoc.on("update", handleUpdate);
    return () => {
      disposed = true;
      yDoc.off("update", handleUpdate);
    };
  }, [captureSnapshot, snapshotSaveQueue, useSnapshotFallback, yDoc]);

  useEffect(() => {
    const realtimeProvider = createDocumentRealtimeProvider({
      accessToken,
      document: yDoc,
      room: {
        documentId: bootstrap.document.id,
        workspaceId
      },
      onAuthenticationFailed: () => {
        setRealtimeError("실시간 공동 편집에 연결하지 못했습니다. 다시 불러오면 재연결합니다.");
        setRealtimeState("disconnected");
      },
      onStatusChange: (status) => {
        setRealtimeState(status);
        if (status === "connected") {
          setRealtimeError(null);
        }
      }
    });

    if (!realtimeProvider) {
      setRealtimeState("disabled");
      return;
    }
    setRealtimeProvider(realtimeProvider);

    return () => {
      setRealtimeProvider((currentProvider) =>
        currentProvider === realtimeProvider ? null : currentProvider
      );
      realtimeProvider.flushPendingUpdates();
      realtimeProvider.destroy();
    };
  }, [accessToken, bootstrap.document.id, workspaceId, yDoc]);

  useEffect(() => {
    return () => {
      if (useSnapshotFallback) {
        void snapshotSaveQueue.flush();
      }
      snapshotSaveQueue.destroy();
    };
  }, [snapshotSaveQueue, useSnapshotFallback]);

  useEffect(() => {
    return () => yDoc.destroy();
  }, [yDoc]);

  const executeSlashCommand = useCallback(
    (commandId: SlashCommandId) => {
      closeSlashMenu();

      if (commandId === "attachment") {
        setIsFilePickerOpen(true);
        return;
      }

      const command = editor?.chain().focus();
      if (!command) return;

      if (commandId === "paragraph") command.setParagraph().run();
      if (commandId === "heading1") command.toggleHeading({ level: 1 }).run();
      if (commandId === "heading2") command.toggleHeading({ level: 2 }).run();
      if (commandId === "heading3") command.toggleHeading({ level: 3 }).run();
      if (commandId === "bulletList") command.toggleBulletList().run();
      if (commandId === "orderedList") command.toggleOrderedList().run();
      if (commandId === "blockquote") command.toggleBlockquote().run();
      if (commandId === "codeBlock") command.toggleCodeBlock().run();
      if (commandId === "horizontalRule") command.setHorizontalRule().run();
    },
    [closeSlashMenu, editor]
  );

  const closeDocument = useCallback(async () => {
    try {
      if (useSnapshotFallback) {
        await snapshotSaveQueue.flush();
      }
      onClose();
    } catch {
      // The save error state keeps the editor open for an explicit retry.
    }
  }, [onClose, snapshotSaveQueue, useSnapshotFallback]);

  const saveStateLabel =
    saveState === "saving"
      ? "저장 중"
      : saveState === "saved"
        ? "저장됨"
        : saveState === "conflict"
          ? "최신 문서 필요"
          : "저장 실패";
  const realtimeStateLabel =
    realtimeState === "connected"
      ? "공동 편집 연결됨"
      : realtimeState === "connecting"
        ? "공동 편집 연결 중"
        : realtimeState === "disabled"
          ? "공동 편집 연결 안 됨"
          : "공동 편집 재연결 중";
  const editorError = saveError ?? realtimeError;

  return (
    <section className={styles.documentPage}>
      <div className={styles.documentHeader}>
        <Button type="button" variant="ghost" size="sm" onClick={() => void closeDocument()}>
          <ArrowLeft />
          파일
        </Button>
        <div className={styles.documentTitleGroup}>
          <h1 className={styles.documentTitle}>
            <DocumentInlineTitle name={documentName} onSave={renameDocument} />
          </h1>
          <p className={styles.documentStatus} role="status">
            {saveStateLabel} · {realtimeStateLabel}
          </p>
        </div>
        <div className={styles.documentActions}>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="문서 저장"
            title="문서 저장"
            disabled={!editor || saveState === "conflict" || !useSnapshotFallback}
            onClick={retrySnapshot}
          >
            {saveState === "saving" ? <Loader2 className="animate-spin" /> : <Save />}
          </Button>
        </div>
      </div>

      {editorError ? (
        <div className={styles.inlineAlert} role="alert">
          <span>{editorError}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={saveError ? retrySnapshot : onReload}
          >
            <RefreshCw />
            다시 불러오기
          </Button>
        </div>
      ) : null}

      <div className={styles.editorSurface}>
        <div className={styles.commandStrip} role="toolbar" aria-label="문서 서식">
          <ToolbarButton label="실행 취소" onClick={() => editor?.chain().focus().undo().run()}>
            <Undo2 />
          </ToolbarButton>
          <ToolbarButton label="다시 실행" onClick={() => editor?.chain().focus().redo().run()}>
            <Redo2 />
          </ToolbarButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolbarButton label="Drive 파일 첨부" onClick={() => setIsFilePickerOpen(true)}>
            <Paperclip />
          </ToolbarButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolbarButton active={editor?.isActive("heading", { level: 1 })} label="제목 1" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("heading", { level: 2 })} label="제목 2" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("heading", { level: 3 })} label="제목 3" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("bulletList")} label="글머리 목록" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <List />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("orderedList")} label="번호 목록" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <ListOrdered />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("blockquote")} label="인용" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
            <Quote />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("codeBlock")} label="코드 블록" onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
            <Code2 />
          </ToolbarButton>
        </div>
        <EditorContent
          editor={editor}
          className={`${styles.editor} ${isEditorEmpty ? styles.emptyEditor : ""}`}
        />
        <DocumentBubbleMenu editor={editor} />
        <DocumentBlockHandle editor={editor} />
      </div>
      <DocumentFilePicker
        open={isFilePickerOpen}
        onOpenChange={setIsFilePickerOpen}
        onSelect={(file) => {
          editor
            ?.chain()
            .focus()
            .insertContent({
              type: "driveFileAttachment",
              attrs: { driveItemId: file.id }
            })
            .run();
        }}
      />
      <DocumentSlashMenu
        activeIndex={slashMenuState?.activeIndex ?? 0}
        onActiveIndexChange={setSlashMenuActiveIndex}
        onClose={() => {
          closeSlashMenu();
          editor?.commands.focus();
        }}
        onQueryChange={setSlashMenuQuery}
        onSelect={executeSlashCommand}
        position={slashMenuState?.position ?? null}
        query={slashMenuState?.query ?? ""}
      />
    </section>
  );
}

export function DriveDocumentEditor({
  documentId,
  onClose
}: {
  documentId: string;
  onClose: () => void;
}) {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const driveClient = useMemo(
    () => createDriveApiClient({ accessToken }),
    [accessToken]
  );
  const [loadState, setLoadState] = useState<EditorLoadState>({ status: "loading" });

  const loadDocument = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setLoadState({ status: "error", message: "문서를 열려면 로그인이 필요합니다." });
      return;
    }

    setLoadState({ status: "loading" });
    try {
      const bootstrap = await driveClient.getDocument(workspaceId, documentId);
      setLoadState({ status: "ready", bootstrap });
    } catch (error) {
      setLoadState({ status: "error", message: messageFromUnknown(error) });
    }
  }, [accessToken, documentId, driveClient, workspaceId]);

  useEffect(() => {
    void loadDocument();
  }, [loadDocument]);

  if (loadState.status === "loading") {
    return (
      <div className={styles.documentPage}>
        <div className={styles.documentStateHeader}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft />
            파일
          </Button>
        </div>
        <div className={styles.loadingState}>
          <Loader2 className="animate-spin" />
          문서를 불러오는 중입니다.
        </div>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className={styles.documentPage}>
        <div className={styles.documentStateHeader}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft />
            파일
          </Button>
        </div>
        <div className={styles.errorState}>
          <AlertCircle className="size-6 text-destructive" />
          <p className="text-sm text-muted-foreground">{loadState.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadDocument()}>
            <RefreshCw />
            다시 시도
          </Button>
        </div>
      </div>
    );
  }

  return (
    <DocumentEditorSurface
      bootstrap={loadState.bootstrap}
      onReload={() => void loadDocument()}
      onClose={onClose}
    />
  );
}
