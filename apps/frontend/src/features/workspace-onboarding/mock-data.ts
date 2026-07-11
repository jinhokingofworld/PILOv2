export const WORKSPACE_ONBOARDING_STEPS = [
  { title: "이름", description: "워크스페이스 이름 설정" },
  { title: "아이콘", description: "워크스페이스 아이콘 설정" },
  { title: "GitHub", description: "GitHub 연결 여부 선택" },
  { title: "저장소", description: "기본 저장소 선택" },
  { title: "프로젝트", description: "기본 프로젝트 선택" }
] as const;

export const ICON_OPTIONS = ["🚀", "✨", "🎯", "🧩", "🌱", "💻"];

// TODO(#740 follow-up): Replace these with GitHub Integration API results.
export const MOCK_REPOSITORIES = [
  {
    id: "pilo-web",
    name: "PILO/pilo-web",
    description: "PILO web application"
  },
  {
    id: "pilo-api",
    name: "PILO/pilo-api",
    description: "PILO API server"
  },
  {
    id: "design-system",
    name: "PILO/design-system",
    description: "Shared UI system"
  }
] as const;

// TODO(#740 follow-up): Replace these with GitHub ProjectV2 API results.
export const MOCK_PROJECTS = [
  {
    id: "product-roadmap",
    name: "Product Roadmap",
    description: "분기별 제품 로드맵"
  },
  {
    id: "engineering",
    name: "Engineering",
    description: "개발 작업과 이슈 관리"
  },
  {
    id: "launch",
    name: "Launch Checklist",
    description: "출시 준비 체크리스트"
  }
] as const;
