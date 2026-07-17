"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  ChatSendOutcome,
  CreateChatMessageInput,
  WorkspaceChatMention
} from "@/features/chat/types";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  createChatComposerRequestScope,
  filterChatMentionMembers,
  findActiveChatMention,
  isChatDraftSubmittable,
  pruneChatMentions,
  replaceActiveChatMention,
  restoreFailedChatDraft,
  upsertChatMentionSelection,
  type ChatMentionMember
} from "@/features/chat/utils/chat-message-text";
import { ChatMentionMenu } from "./chat-mention-menu";

const MENTION_MENU_ID = "chat-composer-mention-menu";

export function ChatComposer({
  currentUserId,
  disabled = false,
  members,
  onSend
}: {
  currentUserId: string;
  disabled?: boolean;
  members: ChatMentionMember[];
  onSend: (
    input: CreateChatMessageInput,
    optimisticMentions: WorkspaceChatMention[]
  ) => Promise<ChatSendOutcome>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [isMentionMenuDismissed, setIsMentionMenuDismissed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mentionSelections, setMentionSelections] = useState<
    WorkspaceChatMention[]
  >([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectionStart, setSelectionStart] = useState(0);
  const [requestScope] = useState(createChatComposerRequestScope);
  const draftRef = useRef(draft);
  const mentionSelectionsRef = useRef(mentionSelections);
  draftRef.current = draft;
  mentionSelectionsRef.current = mentionSelections;
  const activeMention = useMemo(
    () => findActiveChatMention(draft, selectionStart),
    [draft, selectionStart]
  );
  const filteredMembers = useMemo(
    () =>
      activeMention
        ? filterChatMentionMembers(
            members,
            activeMention.query,
            currentUserId
          ).slice(0, 8)
        : [],
    [activeMention, currentUserId, members]
  );
  const isMentionMenuOpen = Boolean(
    activeMention && !isMentionMenuDismissed
  );
  const canSend =
    !disabled && isChatDraftSubmittable(draft, isSubmitting);

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeMention?.query, filteredMembers.length]);

  useEffect(
    () => () => requestScope.invalidate(),
    [requestScope]
  );

  const updateSelection = () => {
    setSelectionStart(textareaRef.current?.selectionStart ?? draft.length);
  };

  const selectMention = (member: ChatMentionMember) => {
    if (!activeMention) return;
    const replacement = replaceActiveChatMention(
      draft,
      activeMention,
      member.displayName
    );

    draftRef.current = replacement.text;
    setDraft(replacement.text);
    setSelectionStart(replacement.cursor);
    setMentionSelections((currentSelections) => {
      const nextSelections = upsertChatMentionSelection(currentSelections, {
        userId: member.userId,
        displayText: replacement.displayText
      });
      mentionSelectionsRef.current = nextSelections;
      return nextSelections;
    });
    setIsMentionMenuDismissed(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        replacement.cursor,
        replacement.cursor
      );
    });
  };

  const submit = async () => {
    if (!canSend) return;
    const requestIsCurrent = requestScope.begin();
    const draftSnapshot = draft;
    const selectionsSnapshot = mentionSelections;
    const optimisticMentions = pruneChatMentions(
      draftSnapshot,
      selectionsSnapshot
    );
    const input: CreateChatMessageInput = {
      clientMessageId: crypto.randomUUID(),
      content: draftSnapshot.trim(),
      mentionedUserIds: optimisticMentions.map(({ userId }) => userId)
    };

    setIsSubmitting(true);
    let outcome: ChatSendOutcome = "failed";
    try {
      const request = onSend(input, optimisticMentions);
      draftRef.current = "";
      mentionSelectionsRef.current = [];
      setDraft("");
      setMentionSelections([]);
      setSelectionStart(0);
      setIsMentionMenuDismissed(false);
      outcome = await request;
    } catch {
      outcome = "failed";
    }

    if (!requestIsCurrent()) return;

    if (outcome === "failed") {
      const restored = restoreFailedChatDraft({
        currentDraft: draftRef.current,
        currentMentionSelections: mentionSelectionsRef.current,
        snapshot: {
          draft: draftSnapshot,
          mentionSelections: selectionsSnapshot
        }
      });
      draftRef.current = restored.draft;
      mentionSelectionsRef.current = restored.mentionSelections;
      setDraft(restored.draft);
      setMentionSelections(restored.mentionSelections);
      toast.error("메시지를 전송하지 못했습니다. 다시 시도해주세요.");
    }
    setIsSubmitting(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const canSelectMention =
      isMentionMenuOpen && filteredMembers.length > 0;

    if (canSelectMention && event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((currentIndex) =>
        (currentIndex + 1) % filteredMembers.length
      );
      return;
    }

    if (canSelectMention && event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((currentIndex) =>
        (currentIndex - 1 + filteredMembers.length) % filteredMembers.length
      );
      return;
    }

    if (isMentionMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setIsMentionMenuDismissed(true);
      return;
    }

    if (
      canSelectMention &&
      event.key === "Enter" &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      selectMention(filteredMembers[selectedIndex] ?? filteredMembers[0]);
      return;
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  const isOverLimit = draft.length > CHAT_MESSAGE_MAX_LENGTH;

  return (
    <form
      className="sticky bottom-0 border-t bg-background/95 p-3 backdrop-blur"
      onSubmit={handleSubmit}
    >
      <div className="relative">
        {isMentionMenuOpen ? (
          <ChatMentionMenu
            id={MENTION_MENU_ID}
            members={filteredMembers}
            onSelect={selectMention}
            selectedIndex={selectedIndex}
          />
        ) : null}

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Textarea
              aria-activedescendant={
                isMentionMenuOpen && filteredMembers.length > 0
                  ? `${MENTION_MENU_ID}-option-${selectedIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={
                isMentionMenuOpen ? MENTION_MENU_ID : undefined
              }
              aria-describedby="chat-composer-help chat-composer-count"
              aria-expanded={isMentionMenuOpen}
              aria-haspopup="listbox"
              aria-invalid={isOverLimit}
              className="max-h-40 min-h-11 resize-none py-2.5"
              disabled={disabled}
              onChange={(event) => {
                draftRef.current = event.target.value;
                setDraft(event.target.value);
                setSelectionStart(event.target.selectionStart);
                setIsMentionMenuDismissed(false);
              }}
              onClick={updateSelection}
              onKeyDown={handleKeyDown}
              onKeyUp={updateSelection}
              onSelect={updateSelection}
              placeholder="메시지를 입력하세요. @로 멤버를 멘션할 수 있습니다."
              ref={textareaRef}
              rows={1}
              role="combobox"
              value={draft}
            />
          </div>
          <Button
            aria-label="메시지 보내기"
            disabled={!canSend}
            size="icon-lg"
            type="submit"
          >
            <Send />
          </Button>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
        <span id="chat-composer-help">
          Enter로 전송 · Shift+Enter로 줄바꿈
        </span>
        <span
          className={isOverLimit ? "font-medium text-destructive" : undefined}
          id="chat-composer-count"
        >
          {draft.length.toLocaleString()}/{CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
        </span>
      </div>
    </form>
  );
}
