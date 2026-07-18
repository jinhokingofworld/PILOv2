import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const readOptional = (path) => read(path).catch(() => "");

const [
  routeBridge,
  featureNavigation,
  page,
  messageList,
  messageItem,
  composer,
  mentionMenu,
  headerNotificationDropdown,
  packageJson,
  testRunner,
] = await Promise.all([
  readOptional("../../app/(workspace)/chat/page.tsx"),
  read("../navigation.ts"),
  readOptional("./page.tsx"),
  readOptional("./components/chat-message-list.tsx"),
  readOptional("./components/chat-message-item.tsx"),
  readOptional("./components/chat-composer.tsx"),
  readOptional("./components/chat-mention-menu.tsx"),
  readOptional("../../components/header-notification-dropdown.tsx"),
  readOptional("../../../package.json"),
  readOptional("../../../scripts/test.mjs"),
]);

assert.equal(
  routeBridge.trim(),
  'export { ChatPage as default } from "@/features/chat/page";',
);
assert.match(featureNavigation, /homeNavigation,\s*chatNavigation,/);
assert.doesNotMatch(
  [
    page,
    messageList,
    messageItem,
    composer,
    mentionMenu,
    headerNotificationDropdown,
  ].join("\n"),
  /dangerouslySetInnerHTML/,
);
assert.match(composer, /event\.nativeEvent\.isComposing/);
assert.match(composer, /CHAT_MESSAGE_MAX_LENGTH/);
assert.match(composer, /aria-activedescendant/);
assert.match(composer, /aria-autocomplete="list"/);
assert.match(composer, /createChatComposerRequestScope/);
assert.match(mentionMenu, /id=\{`\$\{id\}-option-\$\{index\}`\}/);
assert.match(mentionMenu, /secondaryText/);
assert.match(mentionMenu, /마지막으로 선택한 멤버/);
assert.match(messageItem, /message\.author\?\.id === currentUserId/);
assert.match(messageItem, /DropdownMenu/);
assert.match(messageList, /firstUnreadIndex/);
assert.match(messageList, /새 메시지/);
assert.match(messageList, /bottomSentinelRef/);
assert.match(messageList, /data-chat-bottom-sentinel/);
assert.match(page, /listWorkspaceMembers/);
assert.match(page, /useSearchParams\(\)/);
assert.match(page, /messageId/);
assert.match(messageList, /loadMessagePage/);
assert.match(messageList, /loadMessageContext/);
assert.match(page, /mentionErrorMessage/);
assert.match(page, /refreshMentions/);
assert.match(page, /key=\{workspaceId\}/);
assert.match(messageList, /shouldObserveChatRead/);
assert.match(messageList, /readObservationEpoch/);
assert.match(
  messageList,
  /\[readObservationEpoch, targetMessageId, workspaceId\]/,
);
assert.match(headerNotificationDropdown, /workspaceInvitations\.map/);
assert.match(headerNotificationDropdown, /mentions\.map/);
assert.match(headerNotificationDropdown, /getNotificationUnreadCount/);
assert.match(headerNotificationDropdown, /navigateToChatMention/);
assert.match(headerNotificationDropdown, /formatChatNotificationTime/);
assert.match(headerNotificationDropdown, /<time/);
assert.match(headerNotificationDropdown, /listCurrentUserWorkspaceInvitations/);
assert.match(headerNotificationDropdown, /closeInvitationDialogAsRead/);
assert.match(messageList, /loadChatTargetIfMissing/);
assert.match(messageList, /handleChatTargetLoadError/);
assert.match(messageList, /shouldReadVisibleMention/);
assert.match(messageList, /markMentionRead/);
assert.match(messageList, /IntersectionObserver/);
assert.match(messageList, /createChatTargetFocusLifecycle/);
assert.match(messageList, /createVisibleMentionReadRetry/);
assert.match(messageList, /CHAT_TARGET_VISIBILITY_THRESHOLD/);
assert.match(messageList, /CHAT_TARGET_UNAVAILABLE_MESSAGE/);
assert.doesNotMatch(messageList, /lastFocusedTargetRef/);
assert.match(messageItem, /aria-current/);
assert.match(messageItem, /tabIndex=\{-1\}/);
assert.match(packageJson, /"test"[\s\S]*npm run test:chat/);
assert.match(packageJson, /"test:chat-ui"/);
assert.doesNotMatch(
  testRunner,
  /features\/chat\/(?:utils\/chat-message-text|utils\/chat-read-policy|utils\/chat-notification|chat-ui)\.test\.mjs/,
);

await import("./chat-workspace-location.test.mjs");
