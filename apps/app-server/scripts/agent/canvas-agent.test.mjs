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
const { buildCanvasAgentShapeSearchTerms } = require(
  "../../dist/modules/canvas/agent/canvas-agent.repository.js"
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
    this.searchCalls = [];
    this.findByIdCalls = [];
    this.searchResults = [];
    this.shapesById = [];
  }

  async searchShapes(canvasId, query) {
    this.searchCalls.push({ canvasId, query });
    return this.searchResults;
  }

  async findShapesByIds(canvasId, shapeIds) {
    this.findByIdCalls.push({ canvasId, shapeIds });
    return this.shapesById;
  }
}

function run(prompt = "인증 메모 찾아줘") {
  return {
    canvas_id: "canvas-1",
    prompt,
    context_json: { selectedShapeIds: [], viewport: null },
  };
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
  const terms = buildCanvasAgentShapeSearchTerms("회의 메모 위치 안내");

  assert.ok(terms.includes("회의"));
  assert.ok(terms.includes("메모"));
  assert.ok(terms.includes("note"));
  assert.ok(terms.includes("sticky-note"));
  assert.equal(terms.includes("위치"), false);
}

{
  const values = validateCanvasAgentRunRequest({
    prompt: "다시해",
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

  assert.deepEqual(repository.searchCalls, [{ canvasId: "canvas-1", query: "인증" }]);
  assert.equal(result.shouldContinue, true);
  assert.deepEqual(result.resourceRefs, []);
}

{
  const repository = new FakeRepository();
  repository.searchResults = [shape("shape:dashboard")];
  const service = new CanvasAgentActionService(repository);

  const result = await service.execute(
    run("대시보드 와이어프레임 어디 있어?"),
    step({
      intent: "find_shapes",
      arguments: {
        query: "대시보드 와이어프레임",
        routingSource: "llm_intent_classifier",
      },
    }, "route_intent")
  );

  assert.deepEqual(repository.searchCalls, [
    { canvasId: "canvas-1", query: "대시보드 와이어프레임" },
  ]);
  assert.deepEqual(result.resourceRefs, ["shape:dashboard"]);
  assert.match(result.summary, /검색어를 해석해서/);
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
  assert.deepEqual(repository.searchCalls, []);
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

  assert.deepEqual(repository.searchCalls, []);
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
