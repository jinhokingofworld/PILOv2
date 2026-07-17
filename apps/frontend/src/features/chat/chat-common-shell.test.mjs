import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const readOptional = (path) => read(path).catch(() => "");

const [
  chatNavigation,
  featureNavigation,
  workspaceLayout,
  mainShell,
  appSidebar,
] = await Promise.all([
  readOptional("./navigation.ts"),
  read("../navigation.ts"),
  read("../../app/(workspace)/layout.tsx"),
  read("../../components/main-shell.tsx"),
  read("../../components/app-sidebar.tsx"),
]);

assert.match(chatNavigation, /MessageCircle/);
assert.match(chatNavigation, /id: "chat"/);
assert.match(chatNavigation, /title: "채팅"/);
assert.match(chatNavigation, /href: "\/chat"/);
assert.match(chatNavigation, /items: \[\]/);
assert.match(featureNavigation, /homeNavigation,\s*chatNavigation,/);
assert.match(
  workspaceLayout,
  /<RealtimeProvider>[\s\S]*<ChatRuntimeProvider>[\s\S]*<MainShell>\{children\}<\/MainShell>[\s\S]*<\/ChatRuntimeProvider>[\s\S]*<\/RealtimeProvider>/,
);
assert.match(mainShell, /useChatRuntime\(\)/);
assert.match(mainShell, /itemBadges=\{\{\s*chat: summary\.unreadCount\s*\}\}/);
assert.match(appSidebar, /itemBadges\?: Record<string, number>/);
assert.match(appSidebar, /badgeCount > 99 \? "99\+" : badgeCount/);
assert.match(appSidebar, /group-data-\[collapsible=icon\]:hidden/);
assert.match(appSidebar, /group-data-\[collapsible=icon\]:block/);
assert.match(appSidebar, /aria-label=\{`\$\{title\} 읽지 않은 메시지 \$\{badgeCount\}개`\}/);
