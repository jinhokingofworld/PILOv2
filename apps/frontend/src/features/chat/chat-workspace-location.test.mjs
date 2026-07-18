import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createChatWorkspaceLocation,
  getChatScrollOffset,
  readChatTarget,
  waitForChatScrollTarget
} from "./chat-workspace-location.ts";

const metrics = {
  clientHeight: 400,
  clientWidth: 800,
  scrollHeight: 1200,
  scrollLeft: 0,
  scrollTop: 200,
  scrollWidth: 800
};

test("Chat은 선택 message와 메시지 목록 scroll만 capture하고 draft를 제외한다", async () => {
  const location = createChatWorkspaceLocation("message-1", metrics);

  assert.deepEqual(location, {
    context: { messageId: "message-1", threadId: null },
    page: "chat",
    route: { pathname: "/chat", search: "?messageId=message-1" },
    viewport: {
      kind: "element",
      key: "chat-messages",
      xRatio: 0,
      yRatio: 0.25
    }
  });
  assert.deepEqual(readChatTarget(location), {
    messageId: "message-1",
    viewport: location.viewport
  });
  assert.deepEqual(
    getChatScrollOffset(location.viewport, {
      clientHeight: 400,
      clientWidth: 800,
      scrollHeight: 2000,
      scrollWidth: 800
    }),
    { left: 0, top: 400 }
  );

  const adapter = await readFile(new URL("./chat-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(adapter, /draft|composer|content/);
});

test("Chat은 현재 제품에 없는 thread target을 복원하지 않는다", () => {
  const location = createChatWorkspaceLocation(null, metrics);
  assert.deepEqual(location.context, { messageId: null, threadId: null });
  assert.equal(
    readChatTarget({
      ...location,
      context: { messageId: null, threadId: "thread-1" }
    }),
    null
  );
});

test("Chat 메시지 목록 복원 대기는 abort된 stale target을 적용하지 않는다", async () => {
  const controller = new AbortController();
  const pendingTarget = waitForChatScrollTarget({
    findTarget: () => null,
    intervalMs: 1,
    messageId: "message-1",
    signal: controller.signal,
    timeoutMs: 100
  });

  controller.abort();
  assert.equal(await pendingTarget, null);

  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const adapter = await readFile(new URL("./chat-workspace-location-adapter.tsx", import.meta.url), "utf8");
  const messageList = await readFile(new URL("./components/chat-message-list.tsx", import.meta.url), "utf8");
  assert.match(page, /ChatWorkspaceLocationAdapter/);
  assert.match(adapter, /workspaceFollowTargetReady/);
  assert.match(messageList, /data-workspace-follow-surface="chat-messages"/);
  assert.match(messageList, /data-workspace-follow-target-ready/);
});
