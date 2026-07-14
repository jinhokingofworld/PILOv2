export type CanvasAgentToolTarget = {
  aliases: string[];
  description: string;
  label: string;
  message: string;
  target: string;
};

export type CanvasAgentToolTargetResolution = {
  mode: "explain" | "guide";
  tool: CanvasAgentToolTarget;
};

export type CanvasAgentToolTargetPopover = "color" | "draw" | "insert" | "line";

export const canvasAgentToolTargetEventName = "pilo:canvas-agent-tool-target";

const canvasAgentToolShortcutHints: Record<string, string> = {
  선택: "단축키는 V야.",
  메모: "단축키는 N이야.",
  프레임: "단축키는 F야.",
  코드블럭: "단축키는 따로 없어서 코드 아이콘으로 만들면 돼.",
  텍스트: "단축키는 T야.",
  화살표: "단축키는 A야.",
  직선: "단축키는 L이야.",
  "화살표/선": "화살표는 A, 직선은 L로 쓸 수 있어.",
  펜: "단축키는 D야.",
  그리기: "펜은 D, 지우개는 E, 사각형은 R, 원은 O로 쓸 수 있어.",
  형광펜: "단축키는 따로 없어서 그리기 메뉴에서 선택하면 돼.",
  지우개: "단축키는 E야.",
  사각형: "단축키는 R이야.",
  원: "단축키는 O야.",
  삼각형: "단축키는 따로 없어서 그리기 메뉴에서 선택하면 돼.",
  도형: "사각형은 R, 원은 O로 바로 만들 수 있어.",
  색상: "단축키는 따로 없어서 왼쪽 툴바의 색상 스와치를 쓰면 돼.",
  이미지: "단축키는 따로 없어서 더보기 메뉴에서 추가하면 돼.",
  비디오: "단축키는 따로 없어서 더보기 메뉴에서 추가하면 돼.",
  북마크: "단축키는 따로 없어서 더보기 메뉴에서 추가하면 돼.",
  임베드: "단축키는 따로 없어서 더보기 메뉴에서 추가하면 돼.",
  그룹: "단축키는 Ctrl+G야.",
  더보기: "단축키는 따로 없고 왼쪽 툴바의 플러스 아이콘을 누르면 돼.",
  "화면 맞춤": "단축키는 따로 없어서 오른쪽 아래 버튼을 누르면 돼.",
  "자동 정렬": "현재 전용 단축키는 없고 오른쪽 아래 자석 버튼으로 켜고 끄면 돼.",
  휴지통: "단축키는 Delete나 Backspace야.",
  확대: "단축키는 Ctrl++야.",
  축소: "단축키는 Ctrl+-야.",
  "실행 취소": "단축키는 Ctrl+Z야.",
  "다시 실행": "단축키는 Ctrl+Shift+Z 또는 Ctrl+Y야.",
  "Canvas AI": "단축키는 C를 0.5초 길게 누르는 거야.",
};

function withShortcutDescription(target: CanvasAgentToolTarget): CanvasAgentToolTarget {
  const shortcutHint = canvasAgentToolShortcutHints[target.label];

  if (!shortcutHint) {
    return target;
  }

  return {
    ...target,
    description: `${target.description} ${shortcutHint}`,
  };
}

export const canvasAgentToolTargets = [
  {
    aliases: ["선택", "셀렉트", "pointer", "포인터", "커서"],
    description: "선택 도구는 캔버스 위 도형을 고르거나 이동할 때 쓰는 기본 도구야. 다른 도구를 쓰다가 다시 편집 모드로 돌아올 때도 선택을 쓰면 돼.",
    label: "선택",
    message: "선택 도구 찾았어. 왼쪽 툴바의 커서 아이콘이야. 단축키는 V로 쓰면 돼.",
    target: "toolbar.select",
  },
  {
    aliases: ["메모", "노트", "포스트잇", "sticky", "sticky note", "note"],
    description: "메모는 짧은 생각, 요구사항, TODO 같은 텍스트를 캔버스에 빠르게 남기는 기본 노트 도구야.",
    label: "메모",
    message: "메모는 여기야. 왼쪽 툴바의 메모 아이콘을 누르면 돼. 단축키는 N이야.",
    target: "toolbar.memo",
  },
  {
    aliases: ["프레임", "frame", "영역", "묶기", "그룹 공간"],
    description: "프레임은 여러 도형을 하나의 영역 안에 담아 화면이나 흐름 단위로 구분할 때 쓰는 공간 도구야.",
    label: "프레임",
    message: "프레임은 여기 있어. 이 버튼으로 캔버스에 영역을 만들 수 있어. 단축키는 F야.",
    target: "toolbar.frame",
  },
  {
    aliases: ["코드블럭", "코드 블록", "code block", "코드 도구"],
    description: "코드블럭은 JWT 예시나 API 샘플처럼 코드 조각을 캔버스에 보기 좋게 올려두는 도구야.",
    label: "코드블럭",
    message: "코드블럭은 여기야. 단축키는 따로 없어서 코드 아이콘으로 만들면 돼.",
    target: "toolbar.code",
  },
  {
    aliases: ["텍스트", "text", "글자", "글쓰기"],
    description: "텍스트는 메모 카드가 아니라 캔버스 위에 바로 라벨이나 제목을 적고 싶을 때 쓰는 도구야.",
    label: "텍스트",
    message: "텍스트는 여기 있어. T 아이콘을 누르거나 단축키 T로 글자를 배치할 수 있어.",
    target: "toolbar.text",
  },
  {
    aliases: ["화살표", "arrow"],
    description: "화살표는 두 도형의 흐름이나 관계 방향을 보여줄 때 쓰는 연결 도구야.",
    label: "화살표",
    message: "화살표는 이 메뉴 안에 있어. 메뉴를 열어둘게. 단축키 A로도 바로 쓸 수 있어.",
    target: "toolbar.line.arrow",
  },
  {
    aliases: ["직선", "line", "선"],
    description: "직선은 방향성 없이 구분선이나 간단한 연결선을 그릴 때 쓰는 도구야.",
    label: "직선",
    message: "직선은 이 메뉴 안에 있어. 열어둘게. 단축키 L로도 바로 쓸 수 있어.",
    target: "toolbar.line.line",
  },
  {
    aliases: ["연결선", "커넥터", "connector", "화살표/선", "선 도구"],
    description: "화살표/선 메뉴는 관계를 연결하는 도구 모음이야. 방향이 필요하면 화살표, 단순 연결이면 직선을 쓰면 돼.",
    label: "화살표/선",
    message: "화살표와 선은 여기서 고르면 돼. 화살표는 A, 직선은 L로도 쓸 수 있어.",
    target: "toolbar.line",
  },
  {
    aliases: ["펜", "pen", "자유선"],
    description: "펜은 자유롭게 선을 그리거나 손그림처럼 표시하고 싶을 때 쓰는 그리기 도구야.",
    label: "펜",
    message: "펜은 그리기 메뉴 안에 있어. 메뉴를 열어둘게. 단축키 D로도 그릴 수 있어.",
    target: "toolbar.draw.pen",
  },
  {
    aliases: ["그리기", "드로잉", "draw"],
    description: "그리기 메뉴에는 펜, 형광펜, 지우개, 기본 도형이 들어 있어. 캔버스에 직접 그리거나 도형을 만들 때 쓰면 돼.",
    label: "그리기",
    message: "그리기 도구는 여기야. 펜은 D, 지우개는 E, 도형은 R이나 O로 빠르게 쓸 수 있어.",
    target: "toolbar.draw",
  },
  {
    aliases: ["형광펜", "하이라이터", "highlighter", "강조펜"],
    description: "형광펜은 중요한 부분을 두껍고 밝게 강조할 때 쓰는 그리기 도구야.",
    label: "형광펜",
    message: "형광펜 찾았어. 그리기 메뉴를 열어둘게. 단축키는 따로 없어서 여기서 선택하면 돼.",
    target: "toolbar.draw.highlight",
  },
  {
    aliases: ["지우개", "eraser", "삭제펜"],
    description: "지우개는 그린 선이나 드로잉 일부를 지울 때 쓰는 도구야. 도형 전체 삭제는 휴지통이나 Delete 키가 더 빨라.",
    label: "지우개",
    message: "지우개 찾았어. 그리기 메뉴를 열어둘게. 단축키 E로도 지울 수 있어.",
    target: "toolbar.draw.eraser",
  },
  {
    aliases: ["사각형", "네모", "rectangle", "rect"],
    description: "사각형은 카드, 박스, 화면 영역 같은 기본 구조를 만들 때 가장 많이 쓰는 도형이야.",
    label: "사각형",
    message: "사각형은 그리기 메뉴 안에 있어. 메뉴를 열어둘게. 단축키 R로도 만들 수 있어.",
    target: "toolbar.draw.rectangle",
  },
  {
    aliases: ["원", "동그라미", "circle"],
    description: "원 도형은 상태, 포인트, 시작/종료 지점처럼 둥근 형태로 강조하고 싶을 때 쓰면 좋아.",
    label: "원",
    message: "원 도형은 여기 있어. 그리기 메뉴 안에서 고르면 돼. 단축키는 O야.",
    target: "toolbar.draw.circle",
  },
  {
    aliases: ["삼각형", "triangle"],
    description: "삼각형은 방향 표시나 특수한 강조 도형이 필요할 때 쓰는 기본 도형이야.",
    label: "삼각형",
    message: "삼각형도 여기 있어. 그리기 메뉴를 열어둘게. 단축키는 따로 없어서 여기서 선택하면 돼.",
    target: "toolbar.draw.triangle",
  },
  {
    aliases: ["도형", "shape", "마름모"],
    description: "도형 메뉴는 사각형, 원, 삼각형 같은 기본 모양을 만드는 곳이야. 화면 초안이나 다이어그램 뼈대를 만들 때 쓰면 좋아.",
    label: "도형",
    message: "도형은 그리기 메뉴 안에 있어. 사각형은 R, 원은 O로도 바로 만들 수 있어.",
    target: "toolbar.draw",
  },
  {
    aliases: ["색상", "컬러", "color", "색", "팔레트", "스와치"],
    description: "색상은 선택한 도형의 색을 바꾸거나, 다음에 만들 도형의 기본 색을 미리 정하는 기능이야.",
    label: "색상",
    message: "색상은 여기서 바꾸면 돼. 단축키는 따로 없어서 왼쪽 툴바의 스와치를 열어둘게.",
    target: "toolbar.color",
  },
  {
    aliases: ["이미지", "image", "사진"],
    description: "이미지는 캔버스에 로컬 이미지나 참고 스크린샷을 올려둘 때 쓰는 추가 기능이야.",
    label: "이미지",
    message: "이미지는 더보기 메뉴 안에 있어. 단축키는 따로 없어서 여기 버튼으로 추가하면 돼.",
    target: "toolbar.more.image",
  },
  {
    aliases: ["비디오", "video", "영상"],
    description: "비디오는 캔버스에 영상 자료를 붙여두고 흐름이나 참고 자료로 관리할 때 쓰는 추가 기능이야.",
    label: "비디오",
    message: "비디오는 더보기 메뉴 안에 있어. 단축키는 따로 없어서 여기서 영상을 추가하면 돼.",
    target: "toolbar.more.video",
  },
  {
    aliases: ["북마크", "bookmark", "링크 카드"],
    description: "북마크는 URL을 카드 형태로 캔버스에 남겨 관련 문서나 외부 링크를 바로 찾을 수 있게 해주는 기능이야.",
    label: "북마크",
    message: "북마크 찾았어. 단축키는 따로 없어서 더보기 메뉴에서 링크 카드를 만들면 돼.",
    target: "toolbar.more.bookmark",
  },
  {
    aliases: ["임베드", "embed", "iframe", "아이프레임"],
    description: "임베드는 외부 페이지나 삽입 가능한 콘텐츠를 캔버스 카드로 붙여두는 기능이야.",
    label: "임베드",
    message: "임베드는 더보기 메뉴 안에 있어. 단축키는 따로 없어서 여기서 외부 페이지를 붙이면 돼.",
    target: "toolbar.more.embed",
  },
  {
    aliases: ["그룹", "group", "그룹화"],
    description: "그룹은 선택한 여러 도형을 하나처럼 움직이고 관리하고 싶을 때 묶는 기능이야.",
    label: "그룹",
    message: "그룹 기능은 여기야. 더보기 메뉴 안에서 묶을 수 있어. 단축키는 Ctrl+G야.",
    target: "toolbar.more.group",
  },
  {
    aliases: ["더보기", "추가 기능", "plus", "플러스", "메뉴"],
    description: "더보기 메뉴는 이미지, 비디오, 북마크, 임베드, 그룹처럼 기본 툴바 밖의 추가 기능을 모아둔 곳이야.",
    label: "더보기",
    message: "더보기는 이 플러스 아이콘이야. 단축키는 따로 없고, 이미지·북마크·임베드가 여기 있어.",
    target: "toolbar.more",
  },
  {
    aliases: ["화면 맞춤", "맞춤", "fit", "전체 보기", "줌 맞춤"],
    description: "화면 맞춤은 현재 캔버스 내용을 한눈에 보기 좋도록 화면 배율과 위치를 자동으로 맞춰주는 기능이야.",
    label: "화면 맞춤",
    message: "화면 맞춤은 여기 있어. 단축키는 따로 없어서 이 버튼을 누르면 보기 좋게 맞춰줄게.",
    target: "toolbar.fit",
  },
  {
    aliases: ["자동 정렬", "자동정렬", "정렬", "스마트가이드", "스마트 가이드", "smart guide", "자석"],
    description: "자동 정렬은 도형을 움직일 때 기준선과 붙는 느낌으로 정렬을 도와주는 스마트가이드 기능이야. 켜면 그리드 전환도 같이 켜지고, 끄면 같이 꺼져.",
    label: "자동 정렬",
    message: "자동 정렬은 오른쪽 아래 자석 버튼이야. 현재 전용 단축키는 없고 이 버튼으로 켜고 끌 수 있어.",
    target: "controls.smart_guides",
  },
  {
    aliases: ["휴지통", "trash", "삭제", "지우기", "버리기"],
    description: "휴지통은 선택한 도형을 삭제하는 기능이야. 도형을 끌어다 놓거나 버튼을 누르면 선택한 도형을 지울 수 있어.",
    label: "휴지통",
    message: "휴지통은 오른쪽 아래에 있어. 선택한 도형은 Delete나 Backspace로도 지울 수 있어.",
    target: "controls.trash",
  },
  {
    aliases: ["확대", "zoom in", "줌인", "크게"],
    description: "확대는 캔버스 화면을 더 크게 보는 기능이야. 세밀하게 배치하거나 작은 글자를 볼 때 쓰면 좋아.",
    label: "확대",
    message: "확대는 오른쪽 아래 + 버튼이야. 단축키는 Ctrl++로 쓸 수 있어.",
    target: "controls.zoom_in",
  },
  {
    aliases: ["축소", "zoom out", "줌아웃", "작게"],
    description: "축소는 캔버스를 더 넓게 보는 기능이야. 전체 흐름을 보거나 멀리 떨어진 도형을 찾을 때 좋아.",
    label: "축소",
    message: "축소는 오른쪽 아래 - 버튼이야. 단축키는 Ctrl+-로 쓸 수 있어.",
    target: "controls.zoom_out",
  },
  {
    aliases: ["실행 취소", "실행취소", "undo", "되돌리기", "되돌려"],
    description: "실행 취소는 방금 한 캔버스 작업을 이전 상태로 되돌리는 기능이야.",
    label: "실행 취소",
    message: "실행 취소는 왼쪽 기능박스 아래에 있어. 단축키는 Ctrl+Z야.",
    target: "toolbar.undo",
  },
  {
    aliases: ["다시 실행", "다시실행", "redo", "재실행", "앞으로"],
    description: "다시 실행은 실행 취소로 되돌린 작업을 다시 적용하는 기능이야.",
    label: "다시 실행",
    message: "다시 실행은 왼쪽 기능박스 아래에 있어. 단축키는 Ctrl+Shift+Z 또는 Ctrl+Y야.",
    target: "toolbar.redo",
  },
  {
    aliases: ["ai", "canvas ai", "캔버스 ai", "채팅", "도움", "c"],
    description: "Canvas AI는 캔버스 안에서 도형을 찾고, 화면을 이동하고, 초안을 만들거나 기능 위치를 안내해주는 전용 도우미야.",
    label: "Canvas AI",
    message: "나는 여기서 다시 부를 수 있어. 오른쪽 위 AI 아이콘을 누르거나 단축키 C를 0.5초 길게 눌러줘.",
    target: "toolbar.canvas_ai",
  },
].map(withShortcutDescription) satisfies CanvasAgentToolTarget[];

const toolGuideTerms = [
  "버튼",
  "아이콘",
  "열어",
  "어딨어",
  "어디",
  "위치",
  "찾아",
  "툴",
  "툴바",
  "표시",
  "보여",
];

const toolExplainTerms = [
  "기능",
  "기능 설명",
  "무슨 기능",
  "도구",
  "뭐 하는",
  "뭐야",
  "뭔데",
  "설명",
  "사용법",
  "알려",
  "어떻게",
  "어떻게 써",
  "어떻게 사용",
  "언제 써",
  "왜 써",
];

const canvasAgentToolHelpOverview =
  "기능 설명 모드에서는 메모, 도형, 펜, 지우개, 색상, 휴지통처럼 캔버스 툴바에 있는 기능의 위치와 사용법을 물어볼 수 있어요. 예를 들면 “펜은 어디 있어?”, “도형은?”, “지우개 기능 설명해줘”처럼 물어보면 돼요.";

function normalizeToolAliasFollowUp(value: string) {
  return value
    .toLowerCase()
    .replace(/[?!?.~…\s]/g, "")
    .replace(/(?:은요|는요|이요|가요|요|은|는|이|가|을|를|도)$/u, "");
}

function isToolAliasFollowUp(prompt: string, tool: CanvasAgentToolTarget) {
  const normalizedPrompt = normalizeToolAliasFollowUp(prompt);
  if (!normalizedPrompt) return false;
  return tool.aliases.some((alias) => normalizedPrompt === normalizeToolAliasFollowUp(alias));
}

export function readCanvasAgentToolHelpOverview(prompt: string): string | null {
  const normalized = normalizeToolAliasFollowUp(prompt);
  if (!normalized) return null;
  return ["기능", "도움", "도움말", "사용법"].includes(normalized)
    ? canvasAgentToolHelpOverview
    : null;
}

export function resolveCanvasAgentToolTarget(
  prompt: string,
): CanvasAgentToolTargetResolution | null {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return null;
  const match = canvasAgentToolTargets
    .flatMap((tool) =>
      tool.aliases.map((alias) => ({ alias: alias.toLowerCase(), tool })),
    )
    .filter((item) => normalized.includes(item.alias))
    .sort((left, right) => right.alias.length - left.alias.length)[0]?.tool ?? null;
  if (!match) return null;
  const looksLikeToolGuide = toolGuideTerms.some((term) => normalized.includes(term));
  if (looksLikeToolGuide) return { mode: "guide", tool: match };
  const looksLikeExplanation = toolExplainTerms.some((term) => normalized.includes(term));
  return looksLikeExplanation || isToolAliasFollowUp(normalized, match)
    ? { mode: "explain", tool: match }
    : null;
}

export function dispatchCanvasAgentToolTarget(toolTarget: string) {
  window.dispatchEvent(
    new CustomEvent(canvasAgentToolTargetEventName, {
      detail: { toolTarget },
    }),
  );
}

export function getCanvasAgentToolTargetPopover(
  toolTarget: string,
): CanvasAgentToolTargetPopover | null {
  const parts = toolTarget.split(".");
  if (parts.length < 3) return null;
  if (toolTarget.startsWith("toolbar.draw.")) return "draw";
  if (toolTarget.startsWith("toolbar.line.")) return "line";
  if (toolTarget.startsWith("toolbar.more.")) return "insert";
  if (toolTarget.startsWith("toolbar.color.")) return "color";
  return null;
}
