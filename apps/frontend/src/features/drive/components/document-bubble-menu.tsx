"use client";

import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code2, Italic, Strikethrough } from "lucide-react";

import { Button } from "@/components/ui/button";

import styles from "./document-editor.module.css";

function BubbleMenuButton({
  active,
  label,
  onClick,
  children
}: {
  active: boolean;
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
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function DocumentBubbleMenu({ editor }: { editor: Editor | null }) {
  if (!editor) {
    return null;
  }

  return (
    <BubbleMenu
      editor={editor}
      className={styles.bubbleMenu}
      shouldShow={({ editor: nextEditor, from, to }) =>
        nextEditor.isEditable && from !== to && !nextEditor.state.selection.empty
      }
    >
      <BubbleMenuButton
        active={editor.isActive("bold")}
        label="굵게"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </BubbleMenuButton>
      <BubbleMenuButton
        active={editor.isActive("italic")}
        label="기울임"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </BubbleMenuButton>
      <BubbleMenuButton
        active={editor.isActive("strike")}
        label="취소선"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </BubbleMenuButton>
      <BubbleMenuButton
        active={editor.isActive("code")}
        label="인라인 코드"
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code2 />
      </BubbleMenuButton>
    </BubbleMenu>
  );
}
