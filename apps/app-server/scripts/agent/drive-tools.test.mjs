import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DriveAgentToolsService } = require(
  "../../dist/modules/agent/tools/drive-agent-tools.service.js"
);
const { DocumentSearchService } = require(
  "../../dist/modules/drive/document-search.service.js"
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";

const context = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID
};

class FakeDocumentSearchService {
  calls = [];

  async search(currentUserId, workspaceId, input) {
    this.calls.push({ currentUserId, workspaceId, input });
    return [
      {
        documentId: DOCUMENT_ID,
        title: "PILO \uAE30\uD68D\uC11C",
        headingPath: "Agent MVP",
        excerpt: "Board Issue \uC870\uD68C\uC640 \uC77C\uC815 \uBCC0\uACBD \uC2DC\uB098\uB9AC\uC624\uB97C \uC815\uC758\uD588\uC2B5\uB2C8\uB2E4.",
        score: 0.91
      }
    ];
  }
}

function definition(definitions, name) {
  const found = definitions.get(name);
  assert.ok(found, `${name} should be registered`);
  return found;
}

{
  const documentSearchService = new FakeDocumentSearchService();
  const tools = new DriveAgentToolsService(documentSearchService);
  const definitions = new Map(
    tools.listDefinitions().map((tool) => [tool.name, tool])
  );
  const tool = definition(definitions, "search_workspace_documents");

  assert.equal(tool.riskLevel, "low");
  assert.equal(tool.executionMode, "auto");
  assert.deepEqual(tool.inputSchema.required, ["query"]);
  assert.equal(tool.inputSchema.properties.topK.maximum, 8);

  const result = await tool.execute(
    context,
    tool.validateInput({ query: "\uC138\uC778\uC774 ERD 1\uCC28 MVP\uB97C \uC5B4\uB514\uAE4C\uC9C0 \uAD6C\uD604\uD55C\uB2E4\uACE0 \uD588\uC9C0?", topK: 3 })
  );

  assert.deepEqual(documentSearchService.calls, [
    {
      currentUserId: USER_ID,
      workspaceId: WORKSPACE_ID,
      input: {
        query: "\uC138\uC778\uC774 ERD 1\uCC28 MVP\uB97C \uC5B4\uB514\uAE4C\uC9C0 \uAD6C\uD604\uD55C\uB2E4\uACE0 \uD588\uC9C0?",
        topK: 3
      }
    }
  ]);
  assert.equal(result.status, "completed");
  assert.equal(result.outputSummary.count, 1);
  assert.deepEqual(result.outputSummary.documents, [
    {
      title: "PILO \uAE30\uD68D\uC11C",
      headingPath: "Agent MVP",
      excerpt: "Board Issue \uC870\uD68C\uC640 \uC77C\uC815 \uBCC0\uACBD \uC2DC\uB098\uB9AC\uC624\uB97C \uC815\uC758\uD588\uC2B5\uB2C8\uB2E4."
    }
  ]);
  assert.deepEqual(result.resourceRefs, [
    {
      domain: "drive",
      resourceType: "document",
      resourceId: DOCUMENT_ID,
      label: "PILO \uAE30\uD68D\uC11C",
      url: `/files?documentId=${DOCUMENT_ID}`,
      metadata: { headingPath: "Agent MVP" }
    }
  ]);
}

{
  const tools = new DriveAgentToolsService(new FakeDocumentSearchService());
  const tool = definition(
    new Map(tools.listDefinitions().map((item) => [item.name, item])),
    "search_workspace_documents"
  );

  assert.deepEqual(tool.validateInput({ query: "\uBB38\uC11C \uAC80\uC0C9" }), {
    query: "\uBB38\uC11C \uAC80\uC0C9",
    topK: 5
  });
  assert.throws(() => tool.validateInput({ query: "\uBB38\uC11C \uAC80\uC0C9", topK: 9 }));
  assert.throws(() => tool.validateInput({ query: "\uBB38\uC11C \uAC80\uC0C9", workspaceId: WORKSPACE_ID }));
  assert.throws(() => tool.validateInput({ query: " " }));
}

{
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return [
        {
          document_id: DOCUMENT_ID,
          title: " PILO \uAE30\uD68D\uC11C ",
          heading_path: " Agent MVP ",
          chunk_text: "\uC138\uC778\uC774 ERD 1\uCC28 MVP \uAD6C\uD604 \uBC94\uC704\ub97C \uC815\uB9AC\uD588\uC2B5\uB2C8\uB2E4.",
          score: "0.91"
        }
      ];
    }
  };
  const workspaceService = {
    calls: [],
    async assertWorkspaceAccess(currentUserId, workspaceId) {
      this.calls.push({ currentUserId, workspaceId });
    }
  };
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [{ embedding: Array.from({ length: 1536 }, () => 0.01) }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  try {
    const service = new DocumentSearchService(database, workspaceService);
    const result = await service.search(USER_ID, WORKSPACE_ID, {
      query: "ERD 1\uCC28 MVP",
      topK: 3
    });

    assert.deepEqual(workspaceService.calls, [
      { currentUserId: USER_ID, workspaceId: WORKSPACE_ID }
    ]);
    assert.equal(result[0].title, "PILO \uAE30\uD68D\uC11C");
    assert.equal(result[0].headingPath, "Agent MVP");
    assert.equal(result[0].score, 0.91);
    assert.match(calls[0].sql, /document\.latest_snapshot_id = chunk\.snapshot_id/);
    assert.match(calls[0].sql, /document\.deleted_at IS NULL/);
    assert.match(calls[0].sql, /item\.deleted_at IS NULL/);
    assert.deepEqual(calls[0].parameters.slice(0, 1), [WORKSPACE_ID]);
    assert.equal(calls[0].parameters[2], 3);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
}

console.log("agent drive tools tests passed");
