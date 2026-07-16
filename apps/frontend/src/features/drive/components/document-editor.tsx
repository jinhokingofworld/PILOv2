"use client";

import Collaboration from "@tiptap/extension-collaboration";
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

import styles from "./document-editor.module.css";
import { DriveFileAttachment } from "./document-file-attachment";
import { DocumentFilePicker } from "./document-file-picker";
import {
  DocumentSlashMenu,
  SLASH_COMMANDS,
  type SlashCommandId
} from "./document-slash-menu";

type EditorLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bootstrap: DocumentBootstrapPayload };

type SaveState = "saved" | "saving" | "error" | "conflict";

type SlashMenuState = {
  position: { top: number; left: number };
  activeIndex: number;
};

const AUTOSAVE_DELAY_MS = 800;
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef(Promise.resolve());
  const slashMenuStateRef = useRef<SlashMenuState | null>(null);
  const slashCommandExecutorRef = useRef<(commandId: SlashCommandId) => void>(() => {});
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isEditorEmpty, setIsEditorEmpty] = useState(false);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState | null>(null);
  const driveClient = useMemo(
    () => createDriveApiClient({ accessToken }),
    [accessToken]
  );

  useEffect(() => {
    currentVersionRef.current = bootstrap.document.currentVersion;
    setSaveState("saved");
    setSaveError(null);
  }, [bootstrap.document.currentVersion, bootstrap.snapshot.id]);

  const persistSnapshot = useCallback(
    (editor: Editor) => {
      const yjsState = toBase64(Y.encodeStateAsUpdate(yDoc));
      const contentJson = editor.getJSON() as Record<string, unknown>;

      saveQueueRef.current = saveQueueRef.current.then(async () => {
        try {
          const result = await driveClient.saveDocumentSnapshot(
            workspaceId,
            bootstrap.document.id,
            {
              expectedVersion: currentVersionRef.current,
              yjsState,
              contentJson
            }
          );
          currentVersionRef.current = result.document.currentVersion;
          setSaveState("saved");
          setSaveError(null);
        } catch (error) {
          if (error instanceof DriveApiError && error.status === 409) {
            editor.setEditable(false);
            setSaveState("conflict");
            setSaveError("다른 변경이 저장되어 최신 문서를 다시 불러와야 합니다.");
            return;
          }

          setSaveState("error");
          setSaveError(messageFromUnknown(error));
        }
      });
    },
    [bootstrap.document.id, driveClient, workspaceId, yDoc]
  );

  const queueSnapshot = useCallback(
    (editor: Editor, immediately = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      setSaveState("saving");
      setSaveError(null);

      if (immediately) {
        persistSnapshot(editor);
        return;
      }

      saveTimerRef.current = setTimeout(() => {
        persistSnapshot(editor);
      }, AUTOSAVE_DELAY_MS);
    },
    [persistSnapshot]
  );

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

  const handleEditorKeyDown = useCallback(
    (view: EditorView, event: KeyboardEvent) => {
      const currentMenuState = slashMenuStateRef.current;

      if (currentMenuState) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashMenuActiveIndex(
            (currentMenuState.activeIndex + 1) % SLASH_COMMANDS.length
          );
          return true;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashMenuActiveIndex(
            (currentMenuState.activeIndex - 1 + SLASH_COMMANDS.length) %
              SLASH_COMMANDS.length
          );
          return true;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          slashCommandExecutorRef.current(
            SLASH_COMMANDS[currentMenuState.activeIndex].id
          );
          return true;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          closeSlashMenu();
          return true;
        }

        if (
          event.isComposing ||
          event.key === "Process" ||
          event.key === "Dead" ||
          event.key.length === 1 ||
          event.key === "Backspace"
        ) {
          closeSlashMenu();
        }

        return false;
      }

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
        position: {
          top: menuTop,
          left: Math.max(16, Math.min(coordinates.left, window.innerWidth - 336))
        }
      };
      slashMenuStateRef.current = nextState;
      setSlashMenuState(nextState);
      return true;
    },
    [closeSlashMenu, setSlashMenuActiveIndex]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      DriveFileAttachment,
      Collaboration.configure({ document: yDoc })
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
      queueSnapshot(updatedEditor);
    },
    onSelectionUpdate: () => closeSlashMenu()
  });

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      yDoc.destroy();
    };
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

  slashCommandExecutorRef.current = executeSlashCommand;

  const saveStateLabel =
    saveState === "saving"
      ? "저장 중"
      : saveState === "saved"
        ? "저장됨"
        : saveState === "conflict"
          ? "최신 문서 필요"
          : "저장 실패";

  return (
    <section className={styles.documentPage}>
      <div className={styles.documentHeader}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft />
          파일
        </Button>
        <div className={styles.documentTitleGroup}>
          <h1 className={styles.documentTitle}>
            {bootstrap.item.name}
          </h1>
          <p className={styles.documentStatus} role="status">
            {saveStateLabel}
          </p>
        </div>
        <div className={styles.documentActions}>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="문서 저장"
            title="문서 저장"
            disabled={!editor || saveState === "conflict"}
            onClick={() => editor && queueSnapshot(editor, true)}
          >
            {saveState === "saving" ? <Loader2 className="animate-spin" /> : <Save />}
          </Button>
        </div>
      </div>

      {saveError ? (
        <div className={styles.inlineAlert} role="alert">
          <span>{saveError}</span>
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
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
        onSelect={executeSlashCommand}
        position={slashMenuState?.position ?? null}
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
