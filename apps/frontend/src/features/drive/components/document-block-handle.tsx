"use client";

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

type ActiveBlock = {
  left: number;
  position: number;
  top: number;
};

function getBlockPosition(editor: Editor, position: number) {
  const $position = editor.state.doc.resolve(position);
  let fallbackPosition: number | null = null;

  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (node.type.name === "listItem") {
      return $position.before(depth);
    }

    if (node.isBlock && fallbackPosition === null) {
      fallbackPosition = $position.before(depth);
    }
  }

  return fallbackPosition;
}

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
  const [activeBlock, setActiveBlock] = useState<ActiveBlock | null>(null);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const clearActiveBlock = () => setActiveBlock(null);

    const updateActiveBlock = (event: MouseEvent) => {
      if (!editor.isEditable) {
        setActiveBlock(null);
        return;
      }

      const coordinate = editor.view.posAtCoords({
        left: event.clientX + 24,
        top: event.clientY
      });
      if (!coordinate) {
        return;
      }

      const position = getBlockPosition(editor, coordinate.pos);
      if (position === null) {
        return;
      }

      const coordinates = editor.view.coordsAtPos(position + 1);
      setActiveBlock({
        left: Math.max(8, coordinates.left - 32),
        position,
        top: coordinates.top
      });
    };

    editor.view.dom.addEventListener("mousemove", updateActiveBlock);
    window.addEventListener("resize", clearActiveBlock);
    window.addEventListener("scroll", clearActiveBlock, true);

    return () => {
      editor.view.dom.removeEventListener("mousemove", updateActiveBlock);
      window.removeEventListener("resize", clearActiveBlock);
      window.removeEventListener("scroll", clearActiveBlock, true);
    };
  }, [editor]);

  if (!editor || !activeBlock || !editor.isEditable) {
    return null;
  }

  return (
    <div
      className={styles.blockHandle}
      style={{ left: activeBlock.left, top: activeBlock.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <DropdownMenu>
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
              moveBlock(editor, activeBlock.position, "up");
              setActiveBlock(null);
            }}
          >
            <ChevronUp />
            위로 이동
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              moveBlock(editor, activeBlock.position, "down");
              setActiveBlock(null);
            }}
          >
            <ChevronDown />
            아래로 이동
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              duplicateBlock(editor, activeBlock.position);
              setActiveBlock(null);
            }}
          >
            <Copy />
            복제
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              deleteBlock(editor, activeBlock.position);
              setActiveBlock(null);
            }}
          >
            <Trash2 />
            삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
