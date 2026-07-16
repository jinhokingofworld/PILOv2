import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [controller, moduleSource, publisher, service, types, appModule] =
  await Promise.all([
    readFile(new URL("../../src/modules/chat/chat.controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/modules/chat/chat.module.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../src/modules/chat/chat-publisher.service.ts", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../../src/modules/chat/chat.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/modules/chat/chat-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app.module.ts", import.meta.url), "utf8")
  ]);

assert.match(controller, /@Controller\("workspaces\/:workspaceId\/chat"\)/);
assert.match(controller, /@UseGuards\(AuthGuard\)/);
for (const route of [
  '@Get("summary")',
  '@Get("messages")',
  '@Get("messages/:messageId/context")',
  '@Post("messages")',
  '@Delete("messages/:messageId")',
  '@Put("read-state")',
  '@Get("mentions")',
  '@Put("mentions/:mentionId/read")'
]) {
  assert.ok(controller.includes(route), `missing Chat route ${route}`);
}
assert.match(controller, /@CurrentUserId\(\)/);
assert.match(controller, /@Res\(\{ passthrough: true \}\) reply: FastifyReply/);
assert.match(controller, /reply\.status\(result\.replayed \? 200 : 201\)/);
assert.match(controller, /return apiResponse\(result\.message\)/);

assert.match(moduleSource, /imports: \[CommonModule, DatabaseModule, WorkspaceModule\]/);
assert.match(moduleSource, /controllers: \[ChatController\]/);
assert.match(moduleSource, /providers: \[ChatPublisherService, ChatService\]/);
assert.match(appModule, /import \{ ChatModule \} from "\.\/modules\/chat\/chat\.module"/);
assert.equal((appModule.match(/ChatModule/g) ?? []).length, 2);

assert.match(publisher, /CHAT_REDIS_CHANNEL = "chat:events"/);
assert.match(publisher, /process\.env\.REDIS_URL/);
assert.match(publisher, /implements OnModuleDestroy/);
assert.doesNotMatch(controller, /requestFingerprint|request_fingerprint/);
assert.doesNotMatch(publisher, /requestFingerprint|request_fingerprint/);
const publicMessageType = types.match(
  /export type WorkspaceChatMessage = \{[\s\S]*?\n\};/
)?.[0];
assert.ok(publicMessageType, "WorkspaceChatMessage type must exist");
assert.doesNotMatch(publicMessageType, /requestFingerprint|request_fingerprint/);
assert.match(types, /version: 1/);
assert.match(types, /type: "message\.created"/);
assert.match(types, /type: "message\.deleted"/);

const transactionIndex = service.indexOf(
  "const result = await this.database.transaction"
);
const publishIndex = service.indexOf("await this.publisher.publish", transactionIndex);
assert.ok(transactionIndex >= 0, "create must await its transaction");
assert.ok(
  publishIndex > transactionIndex,
  "publisher invocation must occur after the transaction promise resolves"
);
