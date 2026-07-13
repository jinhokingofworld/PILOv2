import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const JOB_ID = "11111111-1111-1111-1111-111111111111";
const SESSION_ID = "22222222-2222-2222-2222-222222222222";
const WORKSPACE_ID = "33333333-3333-3333-3333-333333333333";
const PULL_REQUEST_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const HEAD_SHA = "abcdef123456";
const ROOM_ID = "66666666-6666-4666-8666-666666666666";

function jobRow(overrides = {}) {
  return {
    id: JOB_ID,
    review_session_id: SESSION_ID,
    workspace_id: WORKSPACE_ID,
    head_sha: HEAD_SHA,
    status: "queued",
    room_id: ROOM_ID,
    pull_request_id: PULL_REQUEST_ID,
    created_by_user_id: USER_ID,
    session_head_sha: HEAD_SHA,
    session_status: "analyzing",
    ...overrides
  };
}

function resultBody(overrides = {}) {
  return {
    jobId: JOB_ID,
    reviewSessionId: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    headSha: HEAD_SHA,
    analysis: {
      prPurpose: "PR Review 분석을 비동기로 처리합니다.",
      changeSummary: ["Worker 결과를 저장합니다."],
      recommendedReviewOrder: "App Server 결과 저장부터 확인합니다.",
      cautionPoints: ["head SHA를 다시 확인합니다."],
      flowTitle: "PR 변경 파일 리뷰",
      flowDescription: "분석 결과를 원자적으로 저장합니다.",
      files: [
        {
          filePath: "apps/app-server/src/pr-review.ts",
          fileRole: "서버 로직",
          riskLevel: "medium",
          changeReason: "비동기 결과를 저장합니다.",
          changeSummary: "결과 handoff",
          reviewPoints: ["중복 결과를 확인합니다."]
        }
      ]
    },
    ...overrides
  };
}

class FakeTransaction {
  constructor(
    job,
    {
      carryOverByHeadBlobSha = new Map(),
      throwOnReviewFile = false,
      throwOnRelation = false,
      throwOnShapeMaterialization = false
    } = {}
  ) {
    this.job = job;
    this.carryOverByHeadBlobSha = carryOverByHeadBlobSha;
    this.throwOnReviewFile = throwOnReviewFile;
    this.throwOnRelation = throwOnRelation;
    this.throwOnShapeMaterialization = throwOnShapeMaterialization;
    this.calls = [];
    this.flowCount = 0;
    this.reviewFileCount = 0;
    this.membershipCount = 0;
    this.relationCount = 0;
  }

  async queryOne(text, values = []) {
    this.calls.push({ text, values });
    if (text.includes("FROM pr_review_analysis_jobs")) return this.job;
    if (text.includes("SELECT canvas_id") && text.includes("FROM pr_review_rooms")) {
      return { canvas_id: "canvas-1" };
    }
    if (text.includes("INSERT INTO review_flows")) {
      this.flowCount += 1;
      return { id: `flow-${this.flowCount}` };
    }
    if (text.includes("INSERT INTO pr_review_room_files")) {
      return { id: `room-file-${this.reviewFileCount + 1}` };
    }
    if (text.includes("FROM pr_review_rooms AS review_room")) {
      return this.carryOverByHeadBlobSha.get(values[2]) ?? null;
    }
    if (text.includes("INSERT INTO review_files")) {
      this.reviewFileCount += 1;
      if (this.throwOnReviewFile) throw new Error("review file insert failed");
      return {
        id: `file-${this.reviewFileCount}`,
        room_file_id: `room-file-${this.reviewFileCount}`,
        current_status: values[20]
      };
    }
    if (text.includes("INSERT INTO review_flow_files")) {
      this.membershipCount += 1;
      return { id: `membership-${this.membershipCount}` };
    }
    if (text.includes("INSERT INTO review_flow_relations")) {
      if (this.throwOnRelation) throw new Error("relation insert failed");
      this.relationCount += 1;
      return { id: `relation-${this.relationCount}` };
    }
    if (text.includes("SET status = 'succeeded'")) return { id: JOB_ID };
    if (text.includes("SET status = 'failed'")) return { id: JOB_ID };
    if (text.includes("SET status = 'reviewing'")) return { id: SESSION_ID };
    if (text.includes("UPDATE pr_review_rooms")) return { id: ROOM_ID };
    if (text.includes("analysis_error_code")) return { id: SESSION_ID };
    throw new Error(`Unhandled query: ${text}`);
  }

  async query(text, values = []) {
    this.calls.push({ text, values });
    if (text.includes("FROM canvas_freeform_shapes")) return [];
    throw new Error(`Unhandled query: ${text}`);
  }

  async execute(text, values = []) {
    this.calls.push({ text, values });
    if (
      this.throwOnShapeMaterialization &&
      text.includes("INSERT INTO canvas_freeform_shapes")
    ) {
      throw new Error("canvas shape materialization failed");
    }
    return { rows: [] };
  }
}

class FakeDatabase {
  constructor(job, options = {}) {
    this.job = job;
    this.options = options;
    this.calls = [];
    this.transactionCalls = 0;
    this.rolledBack = false;
    this.transactionState = null;
  }

  async queryOne(text, values = []) {
    this.calls.push({ text, values });
    if (text.includes("FROM pr_review_analysis_jobs")) return this.job;
    throw new Error(`Unhandled query: ${text}`);
  }

  async transaction(callback) {
    this.transactionCalls += 1;
    this.transactionState = new FakeTransaction(this.job, this.options);
    try {
      return await callback(this.transactionState);
    } catch (error) {
      this.rolledBack = true;
      throw error;
    }
  }
}

class FakeGithubDependency {
  constructor({ headSha = HEAD_SHA, files = null } = {}) {
    this.headSha = headSha;
    this.files = files ?? defaultChangedFiles();
    this.detailCalls = [];
    this.fileCalls = [];
  }

  async getPullRequestDetail(...args) {
    this.detailCalls.push(args);
    return {
      id: PULL_REQUEST_ID,
      repositoryId: "repository-id",
      prNumber: 24,
      title: "Async PR analysis",
      body: null,
      state: "open",
      draft: false,
      mergeable: true,
      authorLogin: "pilo",
      authorAvatarUrl: null,
      headBranch: "feature/async-pr-review",
      baseBranch: "dev",
      headSha: this.headSha,
      baseSha: "base-sha",
      changedFilesCount: this.files.length,
      additions: this.files.reduce((sum, file) => sum + file.additions, 0),
      deletions: this.files.reduce((sum, file) => sum + file.deletions, 0),
      commitsCount: 2,
      htmlUrl: "https://github.com/Developer-EJ/PILO/pull/24"
    };
  }

  async getPullRequestChangedFiles(...args) {
    this.fileCalls.push(args);
    return this.files;
  }
}

function defaultChangedFiles() {
  return [
    {
      filePath: "apps/app-server/src/pr-review.ts",
      previousFilePath: null,
      fileName: "pr-review.ts",
      headBlobSha: "blob-pr-review-v1",
      fileStatus: "modified",
      additions: 12,
      deletions: 3,
      isBinary: false,
      isLargeDiff: false,
      githubFileUrl: "https://github.com/Developer-EJ/PILO",
      patch: "+export const asyncReview = true;",
      patchSizeBytes: 34
    }
  ];
}

function semanticChangedFiles() {
  return [
    {
      filePath: "src/user.controller.ts",
      previousFilePath: null,
      fileName: "user.controller.ts",
      headBlobSha: "blob-user-controller-v1",
      fileStatus: "modified",
      additions: 2,
      deletions: 0,
      isBinary: false,
      isLargeDiff: false,
      githubFileUrl: "https://github.com/Developer-EJ/PILO/user.controller.ts",
      patch: '+import { UserService } from "./user.service";',
      patchSizeBytes: 52
    },
    {
      filePath: "src/user.service.ts",
      previousFilePath: null,
      fileName: "user.service.ts",
      headBlobSha: "blob-user-service-v1",
      fileStatus: "modified",
      additions: 3,
      deletions: 1,
      isBinary: false,
      isLargeDiff: false,
      githubFileUrl: "https://github.com/Developer-EJ/PILO/user.service.ts",
      patch: "+export class UserService {}",
      patchSizeBytes: 28
    },
    {
      filePath: "docs/users.md",
      previousFilePath: null,
      fileName: "users.md",
      headBlobSha: "blob-users-doc-v1",
      fileStatus: "modified",
      additions: 1,
      deletions: 0,
      isBinary: false,
      isLargeDiff: false,
      githubFileUrl: "https://github.com/Developer-EJ/PILO/users.md",
      patch: null,
      patchSizeBytes: 0
    }
  ];
}

function semanticResultBody() {
  const body = resultBody();
  body.analysis.files = semanticChangedFiles().map((file) => ({
    filePath: file.filePath,
    fileRole: "AI 분석 역할",
    riskLevel: "medium",
    changeReason: "Semantic Graph 저장 fixture입니다.",
    changeSummary: `${file.additions}줄 추가`,
    reviewPoints: ["Flow와 relation 저장을 확인합니다."]
  }));
  body.analysis.graphSchemaVersion = "pr-review-semantic-graph:v1";
  body.analysis.semanticGraph = {
    files: [
      {
        filePath: "src/user.controller.ts",
        roleType: "entry",
        roleReason: "HTTP 진입점입니다."
      },
      {
        filePath: "src/user.service.ts",
        roleType: "core_logic",
        roleReason: "핵심 사용자 로직입니다."
      },
      {
        filePath: "docs/users.md",
        roleType: "support",
        roleReason: "사용자 기능 문서입니다."
      }
    ],
    relations: [
      {
        candidateKey:
          "depends_on:src/user.controller.ts->src/user.service.ts",
        fromFilePath: "src/user.controller.ts",
        toFilePath: "src/user.service.ts",
        relationType: "depends_on",
        reason: "Controller가 UserService를 사용합니다."
      }
    ],
    flows: [
      {
        candidateKey: "candidate-flow-1",
        title: "사용자 API 변경",
        description: "Controller에서 service 순서로 검토합니다.",
        reviewOrder: ["src/user.controller.ts", "src/user.service.ts"]
      },
      {
        candidateKey: "candidate-flow-fallback",
        title: "사용자 문서 변경",
        description: "독립 문서를 확인합니다.",
        reviewOrder: ["docs/users.md"]
      }
    ]
  };
  return body;
}

function createService(database, github) {
  return new PrReviewService(database, {}, github, {}, {});
}

{
  const database = new FakeDatabase(jobRow());
  const result = await createService(
    database,
    new FakeGithubDependency({ files: semanticChangedFiles() })
  ).storeAnalysisJobResult(JOB_ID, semanticResultBody());

  assert.equal(result.status, "reviewing");
  assert.equal(result.persisted, true);
  const calls = database.transactionState.calls;
  const flowCalls = calls.filter((call) =>
    call.text.includes("INSERT INTO review_flows")
  );
  const fileCalls = calls.filter((call) =>
    call.text.includes("INSERT INTO review_files")
  );
  const membershipCalls = calls.filter((call) =>
    call.text.includes("INSERT INTO review_flow_files")
  );
  const relationCalls = calls.filter((call) =>
    call.text.includes("INSERT INTO review_flow_relations")
  );

  assert.deepEqual(
    flowCalls.map((call) => call.values),
    [
      [SESSION_ID, "사용자 API 변경", "Controller에서 service 순서로 검토합니다.", 1],
      [SESSION_ID, "사용자 문서 변경", "독립 문서를 확인합니다.", 2]
    ]
  );
  assert.equal(fileCalls.length, 3);
  assert.match(fileCalls[0].text, /RETURNING id, room_file_id, current_status/);
  const roomFileCalls = calls.filter((call) =>
    call.text.includes("INSERT INTO pr_review_room_files")
  );
  assert.ok(roomFileCalls.every((call) => /RETURNING id\s*$/.test(call.text)));
  assert.deepEqual(
    fileCalls.map((call) => call.values[13]),
    ["entry", "core_logic", "support"]
  );
  assert.deepEqual(
    fileCalls.map((call) => call.values[18]),
    [
      "blob-user-controller-v1",
      "blob-user-service-v1",
      "blob-users-doc-v1"
    ]
  );
  assert.deepEqual(
    membershipCalls.map((call) => call.values),
    [
      [SESSION_ID, "flow-1", "file-1", 1],
      [SESSION_ID, "flow-1", "file-2", 2],
      [SESSION_ID, "flow-2", "file-3", 1]
    ]
  );
  assert.deepEqual(relationCalls.map((call) => call.values), [
    [
      SESSION_ID,
      "flow-1",
      "membership-1",
      "membership-2",
      "depends_on",
      "hybrid",
      90,
      "Controller가 UserService를 사용합니다."
    ]
  ]);
  const shapeCalls = calls.filter((call) =>
    call.text.includes("INSERT INTO canvas_freeform_shapes")
  );
  assert.equal(shapeCalls.length, 5);
  const existingShapeRead = calls.find((call) =>
    call.text.includes("FROM canvas_freeform_shapes")
  );
  assert.match(existingShapeRead.text, /FOR UPDATE/);
  const lastShapeCallIndex = calls.lastIndexOf(shapeCalls.at(-1));
  const jobSuccessCallIndex = calls.findIndex((call) =>
    call.text.includes("SET status = 'succeeded'")
  );
  assert.ok(lastShapeCallIndex < jobSuccessCallIndex);
}

{
  const reviewedAt = new Date("2026-07-12T12:00:00.000Z");
  const database = new FakeDatabase(jobRow(), {
    carryOverByHeadBlobSha: new Map([
      [
        "blob-pr-review-v1",
        {
          source_decision_id: "decision-1",
          current_status: "approved",
          comment: "이전 버전 판단",
          reviewed_by_user_id: USER_ID,
          reviewed_at: reviewedAt
        }
      ]
    ])
  });

  await createService(
    database,
    new FakeGithubDependency()
  ).storeAnalysisJobResult(JOB_ID, resultBody());

  const carryOverQuery = database.transactionState.calls.find((call) =>
    call.text.includes("FROM pr_review_rooms AS review_room")
  );
  assert.deepEqual(carryOverQuery.values, [
    ROOM_ID,
    "room-file-1",
    "blob-pr-review-v1"
  ]);

  const reviewFileInsert = database.transactionState.calls.find((call) =>
    call.text.includes("INSERT INTO review_files")
  );
  assert.deepEqual(reviewFileInsert.values.slice(18), [
    "blob-pr-review-v1",
    "decision-1",
    "approved",
    "이전 버전 판단",
    USER_ID,
    reviewedAt
  ]);

  const sessionUpdate = database.transactionState.calls.find((call) =>
    call.text.includes("SET status = 'reviewing'")
  );
  assert.match(
    sessionUpdate.text,
    /COUNT\(\*\)::integer[\s\S]*current_status <> 'not_reviewed'/
  );
}

{
  const database = new FakeDatabase(jobRow(), { throwOnRelation: true });
  await assert.rejects(
    () =>
      createService(
        database,
        new FakeGithubDependency({ files: semanticChangedFiles() })
      ).storeAnalysisJobResult(JOB_ID, semanticResultBody()),
    /relation insert failed/
  );
  assert.equal(database.rolledBack, true);
  assert.equal(
    database.transactionState.calls.some((call) =>
      call.text.includes("SET status = 'succeeded'")
    ),
    false
  );
  assert.equal(
    database.transactionState.calls.some((call) =>
      call.text.includes("SET status = 'reviewing'")
    ),
    false
  );
}

{
  const database = new FakeDatabase(jobRow(), {
    throwOnShapeMaterialization: true
  });
  await assert.rejects(
    () =>
      createService(database, new FakeGithubDependency()).storeAnalysisJobResult(
        JOB_ID,
        resultBody()
      ),
    /canvas shape materialization failed/
  );
  assert.equal(database.rolledBack, true);
  assert.equal(
    database.transactionState.calls.some((call) =>
      call.text.includes("SET status = 'succeeded'")
    ),
    false
  );
  assert.equal(
    database.transactionState.calls.some((call) =>
      call.text.includes("SET current_session_id")
    ),
    false
  );
}

{
  const database = new FakeDatabase(jobRow());
  const body = resultBody();
  body.analysis.files = [];
  const result = await createService(
    database,
    new FakeGithubDependency({ files: [] })
  ).storeAnalysisJobResult(JOB_ID, body);

  assert.equal(result.status, "reviewing");
  const calls = database.transactionState.calls;
  const flowCalls = calls.filter((call) =>
    call.text.includes("INSERT INTO review_flows")
  );
  assert.deepEqual(flowCalls.map((call) => call.values), [
    [
      SESSION_ID,
      "PR 변경 파일 리뷰",
      "변경 파일이 없어 리뷰할 파일이 없습니다.",
      1
    ]
  ]);
  assert.equal(
    calls.some((call) => call.text.includes("INSERT INTO review_files")),
    false
  );
  assert.equal(
    calls.some((call) => call.text.includes("INSERT INTO review_flow_files")),
    false
  );
  assert.equal(
    calls.some((call) => call.text.includes("INSERT INTO review_flow_relations")),
    false
  );
}

{
  const database = new FakeDatabase(jobRow());
  const github = new FakeGithubDependency();
  const result = await createService(database, github).storeAnalysisJobResult(
    JOB_ID,
    resultBody()
  );

  assert.deepEqual(result, {
    reviewSessionId: SESSION_ID,
    status: "reviewing",
    persisted: true
  });
  assert.equal(github.detailCalls.length, 1);
  assert.equal(github.fileCalls.length, 1);
  const calls = database.transactionState.calls.map((call) => call.text);
  assert.ok(calls.some((text) => text.includes("INSERT INTO review_flows")));
  assert.ok(calls.some((text) => text.includes("INSERT INTO review_files")));
  assert.ok(calls.some((text) => text.includes("INSERT INTO review_flow_files")));
  assert.ok(calls.some((text) => text.includes("SET status = 'succeeded'")));
  assert.ok(calls.some((text) => text.includes("SET status = 'reviewing'")));
  assert.ok(
    calls.findIndex((text) => text.includes("SET status = 'succeeded'")) <
      calls.findIndex((text) => text.includes("SET status = 'reviewing'"))
  );
  const reviewFileInsert = database.transactionState.calls.find((call) =>
    call.text.includes("INSERT INTO review_files")
  );
  assert.deepEqual(reviewFileInsert.values.slice(18), [
    "blob-pr-review-v1",
    null,
    "not_reviewed",
    null,
    null,
    null
  ]);
}

{
  const database = new FakeDatabase(jobRow());
  const body = resultBody();
  body.analysis.graphSchemaVersion = "pr-review-semantic-graph:v1";
  body.analysis.semanticGraph = {
    files: [
      {
        filePath: "apps/app-server/src/pr-review.ts",
        roleType: "entry",
        roleReason: "낮은 confidence 역할을 보정합니다."
      }
    ],
    relations: [
      {
        candidateKey: null,
        fromFilePath: "apps/app-server/src/pr-review.ts",
        toFilePath: "apps/app-server/src/pr-review.ts",
        relationType: "depends_on",
        reason: "invalid self edge"
      }
    ],
    flows: [
      {
        candidateKey: "candidate-flow-fallback",
        title: "PR 분석 변경",
        description: "잘못된 Graph는 전체 fallback합니다.",
        reviewOrder: ["apps/app-server/src/pr-review.ts"]
      }
    ]
  };

  const result = await createService(
    database,
    new FakeGithubDependency()
  ).storeAnalysisJobResult(JOB_ID, body);

  assert.equal(result.status, "reviewing");
  assert.equal(result.persisted, true);
  assert.ok(
    database.transactionState.calls.some((call) =>
      call.text.includes("INSERT INTO review_flows")
    )
  );
}

{
  const database = new FakeDatabase(
    jobRow({ status: "succeeded", session_status: "reviewing" })
  );
  const github = new FakeGithubDependency();
  const result = await createService(database, github).storeAnalysisJobResult(
    JOB_ID,
    semanticResultBody()
  );

  assert.equal(result.persisted, false);
  assert.equal(result.status, "reviewing");
  assert.equal(database.transactionCalls, 0);
  assert.deepEqual(github.detailCalls, []);
}

{
  const database = new FakeDatabase(
    jobRow({ status: "failed", session_status: "failed" })
  );
  const github = new FakeGithubDependency();
  const result = await createService(database, github).storeAnalysisJobResult(
    JOB_ID,
    resultBody()
  );

  assert.deepEqual(result, {
    reviewSessionId: SESSION_ID,
    status: "failed",
    persisted: false
  });
  assert.equal(database.transactionCalls, 0);
  assert.deepEqual(github.detailCalls, []);
  assert.deepEqual(github.fileCalls, []);
}

{
  const database = new FakeDatabase(jobRow());
  const github = new FakeGithubDependency({ headSha: "different-head" });
  const result = await createService(database, github).storeAnalysisJobResult(
    JOB_ID,
    resultBody()
  );

  assert.deepEqual(result, {
    reviewSessionId: SESSION_ID,
    status: "failed",
    persisted: true
  });
  const calls = database.transactionState.calls;
  assert.equal(calls.some((call) => call.text.includes("INSERT INTO review_flows")), false);
  assert.equal(calls.some((call) => call.text.includes("INSERT INTO review_files")), false);
  assert.equal(calls.some((call) => call.values.includes("PR_HEAD_CHANGED")), true);
}

{
  const database = new FakeDatabase(jobRow({ session_head_sha: "different-head" }));
  const result = await createService(
    database,
    new FakeGithubDependency()
  ).storeAnalysisJobResult(JOB_ID, resultBody());

  assert.equal(result.status, "failed");
  assert.equal(
    database.transactionState.calls.some((call) =>
      call.text.includes("INSERT INTO review_flows")
    ),
    false
  );
}

{
  const database = new FakeDatabase(jobRow(), { throwOnReviewFile: true });
  await assert.rejects(
    () =>
      createService(database, new FakeGithubDependency()).storeAnalysisJobResult(
        JOB_ID,
        resultBody()
      ),
    /review file insert failed/
  );
  assert.equal(database.rolledBack, true);
  assert.equal(
    database.transactionState.calls.some((call) =>
      call.text.includes("SET status = 'reviewing'")
    ),
    false
  );
}

{
  const database = new FakeDatabase(jobRow());
  const result = await createService(
    database,
    new FakeGithubDependency()
  ).storeAnalysisJobFailure(JOB_ID, {
    jobId: JOB_ID,
    reviewSessionId: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    headSha: HEAD_SHA,
    code: "ANALYSIS_PROVIDER_FAILED",
    message: "raw provider exception must not reach the session"
  });

  assert.deepEqual(result, {
    reviewSessionId: SESSION_ID,
    status: "failed",
    persisted: true
  });
  const sessionFailure = database.transactionState.calls.find((call) =>
    call.text.includes("analysis_error_code")
  );
  assert.equal(
    sessionFailure.values.includes("raw provider exception must not reach the session"),
    false
  );
}

await assert.rejects(
  () =>
    createService(new FakeDatabase(jobRow()), new FakeGithubDependency()).storeAnalysisJobResult(
      JOB_ID,
      resultBody({ headSha: "different-head" })
    ),
  (error) => error?.getStatus?.() === 400
);
