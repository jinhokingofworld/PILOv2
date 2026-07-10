import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CanvasAgentActionService } = require(
  "../../dist/modules/canvas/agent/canvas-agent-action.service.js"
);
const { CanvasAgentService } = require(
  "../../dist/modules/canvas/agent/canvas-agent.service.js"
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

  assert.equal(plan.actionName, "find_shapes");
  assert.deepEqual(plan.input, {
    query: "메모",
    continuePlanning: true,
    focusResult: true,
  });
}

{
  const plan = deterministicPlan("일정에 대한 정보가 담긴 메모는 어디있어?");

  assert.equal(plan.actionName, "find_shapes");
  assert.deepEqual(plan.input, {
    query: "일정에 대한 정보가 담긴 메모",
    continuePlanning: true,
    focusResult: true,
  });
}

{
  const plan = deterministicPlan("ERD 있는 곳으로 가줘");

  assert.equal(plan.actionName, "find_shapes");
  assert.deepEqual(plan.input, {
    query: "ERD",
    continuePlanning: true,
    focusResult: true,
  });
}

{
  const plan = deterministicPlan("JWT 관련 도형 선택해줘");

  assert.equal(plan.actionName, "select_shapes");
  assert.deepEqual(plan.input, { query: "JWT" });
}

{
  const plan = deterministicPlan("선택한 메모들 정리해줘", ["shape:a", "shape:b"]);

  assert.equal(plan.actionName, "create_draft");
  assert.deepEqual(plan.input, {
    kind: "organize",
    sourceShapeIds: ["shape:a", "shape:b"],
  });
}

{
  const plan = deterministicPlan("캘린더 일정 불러와서 캔버스에 보여줘");

  assert.equal(plan.actionName, "finish");
  assert.match(plan.input.summary, /외부 도메인 데이터/);
}

{
  const plan = deterministicPlan("로그인 흐름 다이어그램 초안 만들어줘");

  assert.equal(plan, null);
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
