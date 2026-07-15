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

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /기능 설명 모드/);
  assert.match(plan.input.summary, /파일\/폴더 드롭/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
}

{
  const plan = deterministicPlan("뭐 할 수 있어?");

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /기능 설명 모드/);
  assert.match(plan.input.summary, /펜은 어디 있어/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
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

  assert.equal(plan.actionName, "connect_shapes");
  assert.deepEqual(plan.input, {
    fromShapeId: "shape:login",
    toShapeId: "shape:auth",
    connectionKind: "arrow",
  });
}

{
  const plan = deterministicPlan("회의 메모 찾아줘");

  assert.equal(plan.actionName, "find_shapes");
  assert.equal(plan.input.query, "회의 메모");
  assert.equal(plan.input.focusResult, true);
  assert.equal(plan.input.routingSource, "deterministic_search");
}

{
  const plan = deterministicPlan("안녕 너는 누구야");

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /PILO Canvas AI/);
  assert.match(plan.input.summary, /캔버스 위 도형/);
  assert.equal(plan.input.suppressProgress, true);
  assert.equal(plan.showProgress, false);
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
  const service = new CanvasAgentActionService({}, repository);

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
  const service = new CanvasAgentActionService({}, repository);

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
  const service = new CanvasAgentActionService({}, repository);

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
  repository.shapesById = [shape("shape:auth"), shape("shape:login", { x: 240 })];
  const service = new CanvasAgentActionService({}, repository);

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
  const drafts = new CanvasAgentDraftService();
  const repository = new FakeRepository();
  repository.shapesById = [
    shape("shape:login", { x: 100, y: 120, width: 180, height: 100 }),
    shape("shape:auth", { x: 420, y: 120, width: 180, height: 100 }),
  ];
  const service = new CanvasAgentActionService(drafts, repository);

  const result = await service.execute(
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
  );

  assert.equal(result.shouldContinue, false);
  assert.equal(result.shapeBatch.operations.length, 1);
  assert.equal(result.shapeBatch.operations[0].payload.shapeType, "arrow");
  assert.equal(result.shapeBatch.operations[0].payload.x, 280);
  assert.equal(result.shapeBatch.operations[0].payload.y, 170);
  assert.equal(result.shapeBatch.operations[0].payload.width, 140);
  assert.equal(result.shapeBatch.operations[0].payload.height, 1);
  assert.deepEqual(result.shapeBatch.operations[0].payload.rawShape.props.start, {
    type: "point",
    x: 0,
    y: 0,
  });
  assert.deepEqual(result.shapeBatch.operations[0].payload.rawShape.props.end, {
    type: "point",
    x: 140,
    y: 0,
  });
  assert.equal(result.shapeBatch.operations[0].payload.rawShape.props.arrowheadEnd, "arrow");
  assert.deepEqual(result.shapeBatch.operations[0].payload.rawShape.meta.piloArrowBindingsV1, [
    {
      type: "arrow",
      typeName: "binding",
      fromId: result.shapeBatch.operations[0].shapeId,
      toId: "shape:login",
      props: {
        terminal: "start",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
        snap: "center",
      },
      meta: {},
    },
    {
      type: "arrow",
      typeName: "binding",
      fromId: result.shapeBatch.operations[0].shapeId,
      toId: "shape:auth",
      props: {
        terminal: "end",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
        snap: "center",
      },
      meta: {},
    },
  ]);
  assert.deepEqual(repository.findByIdCalls, [
    { canvasId: "canvas-1", shapeIds: ["shape:login", "shape:auth"] },
  ]);
}

{
  const drafts = new CanvasAgentDraftService();
  const repository = new FakeRepository();
  const service = new CanvasAgentActionService(drafts, repository);

  const result = await service.execute(
    {
      ...run("로그인 흐름 다이어그램 만들어줘"),
      context_json: {
        selectedShapeIds: [],
        viewport: { x: 100, y: 100, width: 900, height: 600 },
      },
    },
    step(
      {
        title: "로그인 흐름",
        summary: "로그인 과정을 Canvas 도구로 배치했습니다.",
        nodes: [
          {
            id: "frame-1",
            kind: "frame",
            title: "로그인 흐름",
            x: 100,
            y: 100,
            width: 720,
            height: 360,
            color: "blue",
          },
          {
            id: "step-1",
            kind: "rectangle",
            title: "로그인 페이지",
            x: 48,
            y: 120,
            width: 180,
            height: 88,
            color: "blue",
            parentId: "frame-1",
          },
          {
            id: "step-2",
            kind: "text",
            title: "검증",
            text: "이메일과 비밀번호를 확인합니다.",
            x: 300,
            y: 132,
            width: 240,
            height: 72,
            color: "violet",
            parentId: "frame-1",
          },
        ],
        connections: [{ id: "arrow-1", from: "step-1", to: "step-2", kind: "arrow" }],
        recommendedColors: [
          { name: "blue", label: "파랑", usage: "핵심 화면과 주요 흐름을 표현합니다." },
          { name: "green", label: "초록", usage: "성공 상태를 표현합니다." },
          { name: "pink", label: "분홍", usage: "허용되지 않는 색상입니다." },
        ],
      },
      "create_draft",
    ),
  );

  assert.equal(result.shouldContinue, false);
  assert.equal(result.draftSpec.nodes.length, 3);
  assert.equal(result.draftSpec.nodes[0].x, 180);
  assert.equal(result.draftSpec.nodes[0].y, 180);
  assert.ok(result.draftSpec.nodes.some((node) => node.kind === "rectangle"));
  assert.equal(result.draftSpec.toolSteps.length, 8);
  assert.deepEqual(result.draftSpec.availableColors.map((color) => color.name), [
    "default",
    "black",
    "blue",
    "violet",
    "green",
    "yellow",
    "red",
  ]);
  assert.deepEqual(result.draftSpec.recommendedColors.map((color) => color.name), ["blue", "green"]);

  const batch = drafts.toShapeBatch(result.draftSpec, "client-op");
  assert.equal(batch.operations.length, 4);
  assert.deepEqual(
    batch.operations.map((operation) => operation.payload.shapeType).sort(),
    ["arrow", "frame", "geo", "text"]
  );
  const arrowOperation = batch.operations.find((operation) => operation.payload.shapeType === "arrow");
  assert.equal(arrowOperation.payload.rawShape.meta.piloArrowBindingsV1.length, 2);
  assert.equal(arrowOperation.payload.rawShape.meta.piloArrowBindingsV1[0].fromId, arrowOperation.shapeId);
  assert.equal(arrowOperation.payload.rawShape.meta.piloArrowBindingsV1[0].props.terminal, "start");
  assert.equal(arrowOperation.payload.rawShape.meta.piloArrowBindingsV1[1].fromId, arrowOperation.shapeId);
  assert.equal(arrowOperation.payload.rawShape.meta.piloArrowBindingsV1[1].props.terminal, "end");
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
