"use client";

import {
  Code2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote
} from "lucide-react";

import styles from "./document-editor.module.css";

export const SLASH_COMMANDS = [
  { id: "paragraph", label: "일반 문단", description: "기본 텍스트를 작성합니다.", icon: Pilcrow },
  { id: "heading1", label: "제목 1", description: "큰 제목을 작성합니다.", icon: Heading1 },
  { id: "heading2", label: "제목 2", description: "중간 제목을 작성합니다.", icon: Heading2 },
  { id: "heading3", label: "제목 3", description: "작은 제목을 작성합니다.", icon: Heading3 },
  { id: "bulletList", label: "글머리 목록", description: "점 목록을 만듭니다.", icon: List },
  { id: "orderedList", label: "번호 목록", description: "번호 목록을 만듭니다.", icon: ListOrdered },
  { id: "blockquote", label: "인용", description: "인용 블록을 만듭니다.", icon: Quote },
  { id: "codeBlock", label: "코드 블록", description: "코드를 작성합니다.", icon: Code2 },
  { id: "horizontalRule", label: "구분선", description: "문단 사이에 구분선을 넣습니다.", icon: Minus },
  { id: "attachment", label: "Drive 파일", description: "Workspace Drive 파일을 첨부합니다.", icon: FileText }
] as const;

export type SlashCommandId = (typeof SLASH_COMMANDS)[number]["id"];

export function DocumentSlashMenu({
  activeIndex,
  onSelect,
  position
}: {
  activeIndex: number;
  onSelect: (commandId: SlashCommandId) => void;
  position: { top: number; left: number } | null;
}) {
  if (!position) return null;

  return (
    <div
      className={styles.slashMenu}
      role="listbox"
      aria-label="문서 명령"
      style={{ top: position.top, left: position.left }}
    >
      {SLASH_COMMANDS.map((command, index) => {
        const Icon = command.icon;
        const isActive = index === activeIndex;

        return (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-label={`${command.label} 선택`}
            aria-selected={isActive}
            className={isActive ? styles.slashMenuOptionActive : styles.slashMenuOption}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(command.id);
            }}
          >
            <Icon className={styles.slashMenuIcon} />
            <span className={styles.slashMenuCopy}>
              <span className={styles.slashMenuLabel}>{command.label}</span>
              <span className={styles.slashMenuDescription}>{command.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
