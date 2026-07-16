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
import {
  filterSlashCommands,
  SLASH_COMMANDS,
  type SlashCommandId
} from "./document-slash-commands";

const slashCommandIcons = {
  paragraph: Pilcrow,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  bulletList: List,
  orderedList: ListOrdered,
  blockquote: Quote,
  codeBlock: Code2,
  horizontalRule: Minus,
  attachment: FileText
};

export function DocumentSlashMenu({
  activeIndex,
  onActiveIndexChange,
  onClose,
  onQueryChange,
  onSelect,
  position,
  query
}: {
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (commandId: SlashCommandId) => void;
  position: { top: number; left: number } | null;
  query: string;
}) {
  const filteredCommands = filterSlashCommands(SLASH_COMMANDS, query);

  if (!position) return null;
  const selectedCommand = filteredCommands[activeIndex];

  return (
    <div
      className={styles.slashMenu}
      role="listbox"
      aria-label="문서 명령"
      style={{ top: position.top, left: position.left }}
    >
      <label className={styles.slashMenuSearch}>
        <span>/</span>
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }

            if (event.key === "ArrowDown" && filteredCommands.length > 0) {
              event.preventDefault();
              onActiveIndexChange((activeIndex + 1) % filteredCommands.length);
            }
            if (event.key === "ArrowUp" && filteredCommands.length > 0) {
              event.preventDefault();
              onActiveIndexChange(
                (activeIndex - 1 + filteredCommands.length) % filteredCommands.length
              );
            }
            if (event.key === "Enter" && selectedCommand) {
              event.preventDefault();
              onSelect(selectedCommand.id);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
            if (event.key === "Backspace" && !query) {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="명령 검색"
          aria-label="문서 명령 검색"
        />
      </label>
      {filteredCommands.map((command, index) => {
        const Icon = slashCommandIcons[command.id];
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
      {filteredCommands.length === 0 ? (
        <p className={styles.slashMenuEmpty}>일치하는 명령이 없습니다.</p>
      ) : null}
    </div>
  );
}
