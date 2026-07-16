import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildWorkspaceAvatarEntries,
  getWorkspacePresencePageLabel,
  splitWorkspaceAvatarEntries,
} from "./workspace-member-profiles.ts";

function presence(userId, lastActiveAt, location = null) {
  return {
    displayName: `사용자 ${userId}`,
    focused: true,
    lastActiveAt,
    location,
    userId,
    visible: true,
    workspaceId: "workspace-1",
  };
}

test("profile merge는 현재 사용자를 제외하고 이미지와 initials fallback을 만든다", () => {
  const entries = buildWorkspaceAvatarEntries({
    currentUserId: "me",
    members: [
      {
        userId: "user-1",
        user: { avatarUrl: "https://example.com/avatar.png", name: "세인" },
      },
    ],
    onlineUsers: [
      presence("me", "2026-07-16T00:00:02.000Z"),
      presence("user-1", "2026-07-16T00:00:01.000Z"),
      presence("user-2", "2026-07-16T00:00:00.000Z"),
    ],
  });

  assert.deepEqual(entries.map((entry) => entry.userId), ["user-1", "user-2"]);
  assert.equal(entries[0]?.avatarUrl, "https://example.com/avatar.png");
  assert.equal(entries[0]?.displayName, "세인");
  assert.equal(entries[1]?.initials, "사용");
});

test("header는 최대 네 명과 +N overflow를 계산한다", () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    userId: `user-${index}`,
  }));
  const result = splitWorkspaceAvatarEntries(entries, 4);

  assert.equal(result.visible.length, 4);
  assert.equal(result.overflowCount, 2);
  assert.equal(result.all.length, 6);
});

test("화면 label은 8개 지원 화면을 모두 제공한다", () => {
  assert.deepEqual(
    ["home", "calendar", "board", "sql-erd", "pr-review", "meeting", "canvas", "drive"].map(
      getWorkspacePresencePageLabel,
    ),
    ["홈", "캘린더", "보드", "ERD", "PR 리뷰", "음성 회의", "캔버스", "파일"],
  );
});

test("avatar UI는 tooltip, popover, button, online badge와 두 배치 mode를 사용한다", async () => {
  const component = await readFile(
    new URL("./components/workspace-member-avatars.tsx", import.meta.url),
    "utf8",
  );
  const shell = await readFile(
    new URL("../../components/main-shell.tsx", import.meta.url),
    "utf8",
  );
  const layout = await readFile(
    new URL("../../app/(workspace)/layout.tsx", import.meta.url),
    "utf8",
  );
  const sonner = await readFile(
    new URL("../../components/ui/sonner.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /AvatarGroup/);
  assert.match(component, /AvatarBadge/);
  assert.match(component, /PopoverContent/);
  assert.match(component, /TooltipContent/);
  assert.match(component, /type="button"/);
  assert.match(component, /\+\{overflowCount\}/);
  assert.match(component, /화면으로 이동/);
  assert.match(component, /위치 준비 중/);
  assert.ok(
    shell.indexOf("WorkspaceMemberAvatars") <
      shell.indexOf("HeaderMeetingStatus"),
  );
  assert.match(shell, /mode="floating"/);
  assert.match(shell, /mode="header"/);
  assert.match(layout, /<Toaster/);
  assert.match(sonner, /sonner/);
});
