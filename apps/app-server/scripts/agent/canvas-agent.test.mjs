import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CanvasAgentActionService } = require(
  "../../dist/modules/canvas/agent/canvas-agent-action.service.js"
);
const { CanvasAgentDraftService } = require(
  "../../dist/modules/canvas/agent/canvas-agent-draft.service.js"
);
const { CanvasAgentService } = require(
  "../../dist/modules/canvas/agent/canvas-agent.service.js"
);
const { validateCanvasAgentRunRequest } = require(
  "../../dist/modules/canvas/agent/canvas-agent.validation.js"
);

function shape(id, overrides = {}) {
  return {
    id,
    title: null,
    text_content: null,
    shape_type: "sticky-note",
    x: 10,
    y: 20,
    width: 180,
    height: 100,
    revision: 1,
    raw_shape: {},
    ...overrides,
  };
}

class FakeRepository {
  constructor() {
    this.findByIdCalls = [];
    this.shapesById = [];
  }

  async findShapesByIds(canvasId, shapeIds) {
    this.findByIdCalls.push({ canvasId, shapeIds });
    return this.shapesById;
  }
}

class FakeDriveService {
  constructor(matches = []) {
    this.matches = matches;
    this.searchCalls = [];
  }

  async searchReadyImagesForCanvas(currentUserId, workspaceId, query, limit) {
    this.searchCalls.push({ currentUserId, workspaceId, query, limit });
    return this.matches;
  }
}

function run(prompt = "인증 메모 찾아줘", context = {}) {
  return {
    canvas_id: "canvas-1",
    requested_by_user_id: "user-1",
    workspace_id: "workspace-1",
    prompt,
    context_json: { selectedShapeIds: [], shapeSummaries: [], viewport: null, ...context },
  };
}

{
  const repository = new FakeRepository();
  const driveService = new FakeDriveService([
    {
      fileId: "file-logo",
      fileName: "PILO 로고.png",
      mimeType: "image/png",
      path: "브랜드/PILO 로고.png",
      score: 1100,
    },
  ]);
  const service = new CanvasAgentActionService(repository, driveService);

  const result = await service.execute(
    run("팀에서 올린 PILO 로고를 여기 넣어줘"),
    step({
      intent: "import_drive_file",
      arguments: { query: "PILO 로고" },
    }, "route_intent"),
  );

  assert.deepEqual(driveService.searchCalls, [{
    currentUserId: "user-1",
    workspaceId: "workspace-1",
    query: "PILO 로고",
    limit: 5,
  }]);
  assert.deepEqual(result.clientAction, {
    type: "insert_drive_file",
    file: {
      fileId: "file-logo",
      fileName: "PILO 로고.png",
      mimeType: "image/png",
    },
  });
  assert.deepEqual(result.resourceRefs, ["file-logo"]);
}

{
  const repository = new FakeRepository();
  const driveService = new FakeDriveService([
    {
      fileId: "file-a",
      fileName: "로고-a.png",
      mimeType: "image/png",
      path: "로고-a.png",
      score: 100,
    },
    {
      fileId: "file-b",
      fileName: "로고-b.png",
      mimeType: "image/png",
      path: "로고-b.png",
      score: 100,
    },
  ]);
  const service = new CanvasAgentActionService(repository, driveService);

  const result = await service.execute(
    run("로고 이미지를 넣어줘"),
    step({
      intent: "import_drive_file",
      arguments: { query: "로고" },
    }, "route_intent"),
  );

  assert.equal(result.clientAction, null);
  assert.match(result.summary, /비슷한 이미지가 여러 개/);
  assert.deepEqual(result.resourceRefs, ["file-a", "file-b"]);
}

function step(input, actionName = "find_shapes") {
  return { action_name: actionName, input_json: input };
}

function deterministicPlan(prompt, selectedShapeIds = [], toolHelpMode = false) {
  const service = new CanvasAgentService({}, {}, {}, {}, {}, {});
  return service.planDeterministicAction(prompt, selectedShapeIds, toolHelpMode);
}

{
  const plan = deterministicPlan("메모 도구 어디 있어?", [], true);

  assert.equal(plan.actionName, "find_canvas_tool");
  assert.deepEqual(plan.input, {
    toolTarget: "toolbar.memo",
    toolTargetLabel: "메모",
  });
}

{
  const plan = deterministicPlan("형광펜 도구 찾아줘", [], true);

  assert.equal(plan.actionName, "find_canvas_tool");
  assert.deepEqual(plan.input, {
    toolTarget: "toolbar.draw.highlight",
    toolTargetLabel: "형광펜",
  });
}

{
  const plan = deterministicPlan("지우개 어디 있어?", [], true);

  assert.equal(plan.actionName, "find_canvas_tool");
  assert.deepEqual(plan.input, {
    toolTarget: "toolbar.draw.eraser",
    toolTargetLabel: "지우개",
  });
}

{
  const plan = deterministicPlan("북마크 기능 어디 있어?", [], true);

  assert.equal(plan.actionName, "find_canvas_tool");
  assert.deepEqual(plan.input, {
    toolTarget: "toolbar.more.bookmark",
    toolTargetLabel: "북마크",
  });
}

{
  const plan = deterministicPlan("휴지통 어디 있어?", [], true);

  assert.equal(plan.actionName, "find_canvas_tool");
  assert.deepEqual(plan.input, {
    toolTarget: "controls.trash",
    toolTargetLabel: "휴지통",
  });
}

{
  const plan = deterministicPlan("확대 버튼 찾아줘", [], true);

  assert.equal(plan.actionName, "find_canvas_tool");
  assert.deepEqual(plan.input, {
    toolTarget: "controls.zoom_in",
    toolTargetLabel: "확대",
  });
}

{
  const plan = deterministicPlan("실행취소 위치 알려줘", [], true);

  assert.equal(plan.actionName, "find_canvas_tool");
  assert.deepEqual(plan.input, {
    toolTarget: "toolbar.undo",
    toolTargetLabel: "실행 취소",
  });
}

{
  const plan = deterministicPlan("자동 정렬 기능 설명해줘", [], true);

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /스마트가이드/);
  assert.match(plan.input.summary, /전용 단축키는 없고/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
}

{
  const plan = deterministicPlan("도형 기능 알려줘", [], true);

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /기본 모양/);
  assert.match(plan.input.summary, /사각형은 R/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
}

{
  const plan = deterministicPlan("도형은?", [], true);

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /기본 모양/);
  assert.match(plan.input.summary, /사각형은 R/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
}

{
  const plan = deterministicPlan("기능", [], true);

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /기능 설명 모드/);
  assert.match(plan.input.summary, /펜은 어디 있어/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
}

{
  const plan = deterministicPlan("기능 목록");

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("뭐 할 수 있어?");

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("파일/폴더 드롭", [], true);

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /로컬의 코드 파일이나 폴더/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
}

{
  const plan = deterministicPlan("31번", [], true);

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /로컬의 코드 파일이나 폴더/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
}

{
  const plan = deterministicPlan("펜 도구 알려줘", [], true);

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /자유롭게 선/);
  assert.match(plan.input.summary, /단축키는 D/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
}

{
  const plan = deterministicPlan("도형 기능 어디 있어?", [], true);

  assert.equal(plan.actionName, "find_canvas_tool");
  assert.deepEqual(plan.input, {
    toolTarget: "toolbar.draw",
    toolTargetLabel: "도형",
  });
}

{
  const plan = deterministicPlan("메모 도구 어디 있어?");

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("지우개 어디 있어?");

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("선택한 메모들 정리해줘", ["shape:a", "shape:b"]);

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("캘린더 일정 불러와서 캔버스에 보여줘");

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("로그인 흐름 다이어그램 초안 만들어줘");

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("연결해줘", ["shape:login", "shape:auth"]);

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("회의 메모 찾아줘");

  assert.equal(plan, null);
}

{
  const plan = deterministicPlan("안녕 너는 누구야");

  assert.equal(plan, null);
}

{
  const values = validateCanvasAgentRunRequest({
    prompt: "다시해",
    shapeSummaries: [
      {
        id: "shape:meeting",
        shapeType: "sticky-note",
        title: null,
        text: "회의",
        x: 100,
        y: 120,
        width: 180,
        height: 180,
      },
    ],
    conversationContext: {
      messages: [
        { role: "user", content: "모던한 로그인 페이지 초안 그려줘" },
        { role: "assistant", content: "디자인 초안을 만들었어요." },
      ],
      lastTask: {
        draftId: "draft-1",
        draftTitle: "로그인 페이지 초안",
        prompt: "모던한 로그인 페이지 초안 그려줘",
        status: "draft_ready",
        summary: "디자인 초안을 만들었어요.",
      },
    },
  });

  assert.equal(values.context.conversationContext.messages.length, 2);
  assert.equal(values.context.conversationContext.lastTask.prompt, "모던한 로그인 페이지 초안 그려줘");
  assert.equal(values.context.conversationContext.lastTask.draftId, "draft-1");
  assert.equal(values.context.shapeSummaries[0].text, "회의");
}

{
  const values = validateCanvasAgentRunRequest({
    prompt: "선택 영역을 HTML로 만들어줘",
    selectedShapeIds: ["shape:page", "shape:title"],
    selectedScene: {
      selectionMode: "frame",
      bounds: { width: 1440, height: 900 },
      rootShapeIds: ["shape:page"],
      shapes: [
        {
          id: "shape:page",
          shapeType: "frame",
          parentId: null,
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
          rotation: 0,
          zIndex: 0,
          depth: 0,
          title: "대시보드",
          text: null,
          assetRef: null,
          style: { backgroundColor: "#ffffff" },
        },
        {
          id: "shape:title",
          shapeType: "text",
          parentId: "shape:page",
          x: 80,
          y: 60,
          width: 240,
          height: 48,
          rotation: 0,
          zIndex: 1,
          depth: 1,
          title: null,
          text: "대시보드",
          assetRef: null,
          style: { color: "black" },
        },
      ],
      options: { styleMode: "faithful", responsive: false, includeJavaScript: false },
    },
  });

  assert.equal(values.context.selectedScene.selectionMode, "frame");
  assert.equal(values.context.selectedScene.shapes.length, 2);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("REST API가 뭐야?"),
    step({
      intent: "chat",
      arguments: {
        answer: "REST API는 HTTP를 통해 자원을 다루는 인터페이스입니다.",
        contextScope: "none",
        reasonCode: "general_question",
      },
    }, "route_intent"),
  );

  assert.equal(result.summary, "REST API는 HTTP를 통해 자원을 다루는 인터페이스입니다.");
  assert.equal(result.artifact, null);
  assert.deepEqual(result.resourceRefs, []);
  assert.equal(result.shouldContinue, false);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  await assert.rejects(
    service.execute(
      run("이 프레임 구성이 어때?"),
      step({
        intent: "chat",
        arguments: {
          answer: "선택한 프레임을 분석했습니다.",
          contextScope: "whole_canvas",
          reasonCode: "selection_question",
        },
      }, "route_intent"),
    ),
    (error) => error.response?.error?.message === "Canvas Agent chat contextScope is invalid",
  );
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("자동 정렬 기능 설명해줘"),
    step({ summary: "자동 정렬 설명", suppressProgress: true }, "finish")
  );

  assert.equal(result.shouldContinue, false);
  assert.equal(result.summary, "자동 정렬 설명");
  assert.equal(result.progress, null);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("메모 도구 어디 있어?"),
    step({ toolTarget: "toolbar.memo" }, "find_canvas_tool")
  );

  assert.equal(result.shouldContinue, false);
  assert.deepEqual(result.resourceRefs, ["toolbar.memo"]);
  assert.equal(result.progress.toolTarget, "toolbar.memo");
  assert.match(result.summary, /메모.*여기/);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run(),
    step({ query: "인증", continuePlanning: true, focusResult: false })
  );

  assert.equal(result.shouldContinue, true);
  assert.deepEqual(result.resourceRefs, []);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("대시보드 와이어프레임 어디 있어?", {
      shapeSummaries: [
        {
          id: "shape:dashboard",
          shapeType: "frame",
          title: "대시보드 와이어프레임",
          text: null,
          x: 240,
          y: 320,
          width: 640,
          height: 480,
        },
      ],
    }),
    step({
      intent: "find_shapes",
      arguments: {
        query: "대시보드 와이어프레임",
        shapeIds: ["shape:dashboard"],
        routingSource: "client_shape_context",
      },
    }, "route_intent")
  );

  assert.deepEqual(repository.findByIdCalls, []);
  assert.deepEqual(result.resourceRefs, ["shape:dashboard"]);
  assert.match(result.summary, /현재 캔버스에서/);
}

{
  const repository = new FakeRepository();
  repository.shapesById = [shape("shape:dashboard", {
    shape_type: "frame",
    title: "대시보드 와이어프레임",
  })];
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("대시보드 와이어프레임 어디 있어?"),
    step({
      intent: "find_shapes",
      arguments: {
        query: "대시보드 와이어프레임",
        shapeIds: ["shape:dashboard"],
        routingSource: "database_text",
      },
    }, "route_intent")
  );

  assert.deepEqual(repository.findByIdCalls, [{
    canvasId: "canvas-1",
    shapeIds: ["shape:dashboard"],
  }]);
  assert.deepEqual(result.resourceRefs, ["shape:dashboard"]);
  assert.match(result.summary, /DB 검색으로/);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);
  const html = "<!doctype html><html><head><style>body{margin:0}</style></head><body>대시보드</body></html>";

  const result = await service.execute(
    run("선택 영역을 HTML로 만들어줘", {
      selectedScene: {
        shapes: [{ id: "shape:page" }, { id: "shape:title" }],
      },
    }),
    step({
      intent: "generate_html",
      arguments: {
        artifact: {
          kind: "html",
          title: "대시보드",
          html,
          sourceShapeIds: ["shape:page", "shape:title"],
        },
      },
    }, "route_intent"),
  );

  assert.equal(result.artifact.html, html);
  assert.deepEqual(result.resourceRefs, ["shape:page", "shape:title"]);
  assert.match(result.summary, /정적 HTML\/CSS/);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  await assert.rejects(
    service.execute(
      run("선택 영역을 HTML로 만들어줘", {
        selectedScene: { shapes: [{ id: "shape:page" }] },
      }),
      step({
        intent: "generate_html",
        arguments: {
          artifact: {
            kind: "html",
            title: "대시보드",
            html: "<!doctype html><html><script>alert(1)</script></html>",
            sourceShapeIds: ["shape:page"],
          },
        },
      }, "route_intent"),
    ),
    (error) => error.response?.error?.message === "코드 생성 중 오류가 났어요. 다시 시도해 주세요.",
  );
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("HTML로 만들어줘"),
    step({
      intent: "generate_html",
      arguments: { missingSelection: true },
    }, "route_intent"),
  );

  assert.equal(result.artifact, null);
  assert.equal(result.summary, "HTML로 만들 캔버스 영역을 먼저 선택해주세요.");
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("선택한 도형을 삭제해줘"),
    step({ intent: "unsupported", arguments: {} }, "route_intent"),
  );

  assert.equal(result.shouldContinue, false);
  assert.match(result.summary, /기존 도형 찾기.*정적 HTML\/CSS 생성/);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  await assert.rejects(
    service.execute(
      run("대시보드 만들어줘"),
      step({ intent: "create_shapes", arguments: { query: "대시보드" } }, "route_intent")
    ),
    (error) => error.response?.error?.message === "Canvas Agent intent is not supported",
  );
  assert.deepEqual(repository.findByIdCalls, []);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  await assert.rejects(
    service.execute(
      run("대시보드 어디 있어?"),
      step({ intent: "find_shapes", arguments: {} }, "route_intent")
    ),
    (error) => error.response?.error?.message === "Canvas Agent find_shapes intent query is required",
  );
}

{
  const repository = new FakeRepository();
  repository.shapesById = [shape("shape:auth"), shape("shape:login", { x: 240 })];
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("인증 흐름 있는 곳으로 가줘"),
    step({
      query: "인증 흐름",
      shapeIds: ["shape:auth", "shape:login"],
      continuePlanning: false,
      focusResult: true,
    })
  );

  assert.deepEqual(repository.findByIdCalls, [
    { canvasId: "canvas-1", shapeIds: ["shape:auth", "shape:login"] },
  ]);
  assert.equal(result.shouldContinue, false);
  assert.deepEqual(result.resourceRefs, ["shape:auth", "shape:login"]);
  assert.deepEqual(result.progress.highlightedShapeIds, ["shape:auth", "shape:login"]);
  assert.notEqual(result.progress.targetViewport, null);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  await assert.rejects(
    service.execute(
      run("로그인 화면이랑 인증 메모 연결해줘"),
      {
        action_name: "connect_shapes",
        id: "step-connect",
        input_json: {
          fromShapeId: "shape:login",
          toShapeId: "shape:auth",
          connectionKind: "arrow",
        },
      },
    ),
    (error) => error.response?.error?.message === "Canvas Agent shape creation is disabled",
  );
  assert.deepEqual(repository.findByIdCalls, []);
}

{
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(repository);

  await assert.rejects(
    service.execute(
      run("로그인 흐름 다이어그램 만들어줘"),
      step({}, "create_draft"),
    ),
    (error) => error.response?.error?.message === "Canvas Agent shape creation is disabled",
  );
}

{
  const drafts = new CanvasAgentDraftService();
  const spec = drafts.createDraftSpec({
    kind: "diagram",
    prompt: "로그인 페이지 디자인 와이어프레임 그려줘",
    sourceShapes: [],
    viewport: null,
    title: "로그인 페이지",
    summary: "로그인 화면 와이어프레임",
    nodes: [
      {
        id: "screen",
        kind: "frame",
        title: "로그인 페이지",
        x: 100,
        y: 100,
        width: 360,
        height: 420,
        color: "blue",
      },
      {
        id: "email",
        kind: "rectangle",
        title: "이메일 입력",
        x: 80,
        y: 96,
        width: 260,
        height: 56,
        parentId: "screen",
      },
      {
        id: "password",
        kind: "rectangle",
        title: "비밀번호 입력",
        x: 80,
        y: 108,
        width: 260,
        height: 56,
        parentId: "screen",
      },
      {
        id: "login",
        kind: "rectangle",
        title: "로그인 버튼",
        x: 80,
        y: 120,
        width: 260,
        height: 56,
        parentId: "screen",
      },
    ],
    connections: [],
    recommendedColors: [{ name: "blue", label: "파랑", usage: "주요 액션" }],
  });
  const frame = spec.nodes.find((node) => node.kind === "frame");
  const children = spec.nodes.filter((node) => node.parentId === frame.id);

  assert.equal(spec.nodes.length, 4);
  assert.ok(frame.width >= 360);
  assert.ok(frame.height >= 420);
  assert.equal(children.length, 3);
  assert.ok(children.every((node) => node.x >= 32 && node.y >= 32));
  assert.ok(children.every((node) => node.x + node.width <= frame.width - 32));
  for (let index = 1; index < children.length; index += 1) {
    assert.ok(
      children[index].y >= children[index - 1].y + children[index - 1].height + 16,
      "layout repair must push overlapping wireframe controls apart"
    );
  }
}
