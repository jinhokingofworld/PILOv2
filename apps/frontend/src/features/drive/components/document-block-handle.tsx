"use client";

import DragHandle from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, Copy, GripVertical, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

import styles from "./document-editor.module.css";

function moveBlock(editor: Editor, position: number, direction: "up" | "down") {
  const node = editor.state.doc.nodeAt(position);
  if (!node) {
    return;
  }

  const $position = editor.state.doc.resolve(position);
  const siblingIndex = $position.index();
  const siblingOffset = direction === "up" ? siblingIndex - 1 : siblingIndex + 1;

  if (siblingOffset < 0 || siblingOffset >= $position.parent.childCount) {
    return;
  }

  const sibling = $position.parent.child(siblingOffset);
  const nextPosition =
    direction === "up" ? position - sibling.nodeSize : position + sibling.nodeSize;
  const transaction = editor.state.tr
    .delete(position, position + node.nodeSize)
    .insert(nextPosition, node)
    .scrollIntoView();

  editor.view.dispatch(transaction);
}

function duplicateBlock(editor: Editor, position: number) {
  const node = editor.state.doc.nodeAt(position);
  if (!node) {
    return;
  }

  editor.chain().focus().insertContentAt(position + node.nodeSize, node.toJSON()).run();
}

function deleteBlock(editor: Editor, position: number) {
  const node = editor.state.doc.nodeAt(position);
  if (!node) {
    return;
  }

  if (editor.state.doc.childCount === 1 && node.isTextblock) {
    editor.commands.clearContent();
    return;
  }

  editor.chain().focus().setNodeSelection(position).deleteSelection().run();
}

export function DocumentBlockHandle({ editor }: { editor: Editor | null }) {
  const [activeBlockPosition, setActiveBlockPosition] = useState<number | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.commands.setMeta("lockDragHandle", isMenuOpen);

    return () => {
      if (!editor.isDestroyed) {
        editor.commands.setMeta("lockDragHandle", false);
      }
    };
  }, [editor, isMenuOpen]);

  if (!editor || !editor.isEditable) {
    return null;
  }

  return (
    <DragHandle
      editor={editor}
      nested={{
        allowedContainers: ["bulletList", "orderedList"],
        edgeDetection: { threshold: -16 }
      }}
      onNodeChange={({ pos }) => setActiveBlockPosition(pos)}
    >
      <div className={styles.blockHandle}>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="블록 작업"
              title="블록 작업"
            />
          }
        >
          <GripVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem
            onClick={() => {
              if (activeBlockPosition !== null) {
                moveBlock(editor, activeBlockPosition, "up");
              }
              setIsMenuOpen(false);
            }}
          >
            <ChevronUp />
            위로 이동
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              if (activeBlockPosition !== null) {
                moveBlock(editor, activeBlockPosition, "down");
              }
              setIsMenuOpen(false);
            }}
          >
            <ChevronDown />
            아래로 이동
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              if (activeBlockPosition !== null) {
                duplicateBlock(editor, activeBlockPosition);
              }
              setIsMenuOpen(false);
            }}
          >
            <Copy />
            복제
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              if (activeBlockPosition !== null) {
                deleteBlock(editor, activeBlockPosition);
              }
              setIsMenuOpen(false);
            }}
          >
            <Trash2 />
            삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </DragHandle>
  );
}
