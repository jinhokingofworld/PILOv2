import type { WorkspaceChatMention } from "@/features/chat/types";

export const CHAT_MESSAGE_MAX_LENGTH = 4_000;

export type ChatMessageSegment =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "link";
      text: string;
      href: string;
    }
  | {
      kind: "mention";
      text: string;
      userId: string;
    };

export type ChatMentionMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  secondaryText: string;
};

export type ActiveChatMention = {
  start: number;
  end: number;
  query: string;
};

const absoluteHttpUrl = /^https?:\/\/[^\s]+/iu;
const trailingUrlPunctuation = /[),.!?;:}\]]$/u;

export function segmentChatMessage(
  content: string,
  mentions: WorkspaceChatMention[]
): ChatMessageSegment[] {
  const mentionTokens = [...mentions]
    .filter(({ displayText }) => displayText.length > 0)
    .sort((first, second) => second.displayText.length - first.displayText.length);
  const segments: ChatMessageSegment[] = [];
  let textStart = 0;
  let index = 0;

  const flushText = (end: number) => {
    if (end <= textStart) return;
    segments.push({ kind: "text", text: content.slice(textStart, end) });
  };

  while (index < content.length) {
    const rest = content.slice(index);
    const urlMatch = rest.match(absoluteHttpUrl)?.[0];
    if (urlMatch) {
      let linkText = urlMatch;
      while (linkText.length > 0 && trailingUrlPunctuation.test(linkText)) {
        linkText = linkText.slice(0, -1);
      }

      if (linkText.length > 0) {
        flushText(index);
        segments.push({ kind: "link", text: linkText, href: linkText });
        index += linkText.length;
        textStart = index;
        continue;
      }
    }

    const mention = mentionTokens.find(({ displayText }) =>
      isExactChatMentionTokenAt(content, index, displayText)
    );
    if (mention) {
      flushText(index);
      segments.push({
        kind: "mention",
        text: mention.displayText,
        userId: mention.userId
      });
      index += mention.displayText.length;
      textStart = index;
      continue;
    }

    index += 1;
  }

  flushText(content.length);
  return segments;
}

export function findActiveChatMention(
  text: string,
  cursor: number
): ActiveChatMention | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const beforeCursor = text.slice(0, safeCursor);
  const start = beforeCursor.lastIndexOf("@");
  if (start < 0) return null;

  const precedingCharacter = text[start - 1];
  if (precedingCharacter && /[\p{L}\p{N}_]/u.test(precedingCharacter)) {
    return null;
  }

  const query = text.slice(start + 1, safeCursor);
  if (/\s|@/u.test(query)) return null;

  let end = safeCursor;
  while (end < text.length && !/\s/u.test(text[end])) end += 1;

  return { start, end, query };
}

export function filterChatMentionMembers(
  members: ChatMentionMember[],
  query: string,
  currentUserId: string
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return members.filter(
    ({ displayName, userId }) =>
      userId !== currentUserId &&
      displayName.toLocaleLowerCase().includes(normalizedQuery)
  );
}

export function replaceActiveChatMention(
  text: string,
  activeMention: ActiveChatMention,
  displayName: string
) {
  const displayText = `@${displayName}`;
  const suffixStart =
    text[activeMention.end] === " "
      ? activeMention.end + 1
      : activeMention.end;
  const nextText = `${text.slice(0, activeMention.start)}${displayText} ${text.slice(
    suffixStart
  )}`;

  return {
    cursor: activeMention.start + displayText.length + 1,
    displayText,
    text: nextText
  };
}

export function upsertChatMentionSelection(
  selections: WorkspaceChatMention[],
  nextSelection: WorkspaceChatMention
) {
  return [
    ...selections.filter(
      ({ displayText, userId }) =>
        userId !== nextSelection.userId &&
        displayText !== nextSelection.displayText
    ),
    nextSelection
  ];
}

export function isExactChatMentionTokenAt(
  text: string,
  index: number,
  displayText: string
) {
  if (!displayText || !text.startsWith(displayText, index)) return false;
  return (
    isChatMentionBoundary(text[index - 1]) &&
    isChatMentionBoundary(text[index + displayText.length])
  );
}

export function pruneChatMentions(
  text: string,
  selections: WorkspaceChatMention[]
) {
  const retainedSelections: WorkspaceChatMention[] = [];
  const seenDisplayTexts = new Set<string>();
  const seenUserIds = new Set<string>();

  for (let index = selections.length - 1; index >= 0; index -= 1) {
    const selection = selections[index];
    if (
      !selection.displayText ||
      seenDisplayTexts.has(selection.displayText) ||
      seenUserIds.has(selection.userId)
    ) {
      continue;
    }
    seenDisplayTexts.add(selection.displayText);
    seenUserIds.add(selection.userId);

    if (containsExactChatMention(text, selection.displayText)) {
      retainedSelections.unshift(selection);
    }
  }

  return retainedSelections;
}

export function pruneChatMentionIds(
  text: string,
  selections: WorkspaceChatMention[]
) {
  return pruneChatMentions(text, selections).map(({ userId }) => userId);
}

export function isChatDraftSubmittable(text: string, isSubmitting: boolean) {
  return (
    !isSubmitting &&
    text.trim().length > 0 &&
    text.length <= CHAT_MESSAGE_MAX_LENGTH
  );
}

export function restoreFailedChatDraft({
  currentDraft,
  currentMentionSelections,
  snapshot
}: {
  currentDraft: string;
  currentMentionSelections: WorkspaceChatMention[];
  snapshot: {
    draft: string;
    mentionSelections: WorkspaceChatMention[];
  };
}) {
  return currentDraft.length > 0
    ? {
        draft: currentDraft,
        mentionSelections: currentMentionSelections
      }
    : snapshot;
}

export function createChatComposerRequestScope() {
  let generation = 0;
  return {
    begin() {
      const requestGeneration = ++generation;
      return () => requestGeneration === generation;
    },
    invalidate() {
      generation += 1;
    }
  };
}

function containsExactChatMention(text: string, displayText: string) {
  let index = text.indexOf(displayText);
  while (index >= 0) {
    if (isExactChatMentionTokenAt(text, index, displayText)) return true;
    index = text.indexOf(displayText, index + 1);
  }
  return false;
}

function isChatMentionBoundary(character: string | undefined) {
  return character === undefined || !/[\p{L}\p{N}_]/u.test(character);
}
