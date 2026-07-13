import type {
  PrReviewFileRoleType,
  PrReviewFlowFile
} from "@/features/pr-review/types";

export type PrReviewRoleLane = {
  roleType: PrReviewFileRoleType;
  label: string;
  description: string;
  files: PrReviewFlowFile[];
};

const ROLE_LANE_ORDER: PrReviewFileRoleType[] = [
  "entry",
  "api_contract",
  "core_logic",
  "ui_state",
  "verification",
  "support",
  "unknown"
];

const ROLE_LANE_COPY: Record<
  PrReviewFileRoleType,
  Pick<PrReviewRoleLane, "label" | "description">
> = {
  entry: {
    label: "진입점",
    description: "기능 흐름이 시작되는 파일"
  },
  api_contract: {
    label: "API / 계약",
    description: "외부 경계와 데이터 계약"
  },
  core_logic: {
    label: "핵심 로직",
    description: "주요 동작을 구현하는 코드"
  },
  ui_state: {
    label: "UI / 상태",
    description: "화면과 사용자 상태 변경"
  },
  verification: {
    label: "검증",
    description: "테스트와 동작 검증"
  },
  support: {
    label: "지원 파일",
    description: "문서, 설정과 보조 변경"
  },
  unknown: {
    label: "기타",
    description: "역할을 확정하기 어려운 변경"
  }
};

export function sortPrReviewFlowFiles(files: PrReviewFlowFile[]) {
  return [...files].sort(
    (left, right) =>
      left.workflowOrder - right.workflowOrder ||
      left.reviewFileId.localeCompare(right.reviewFileId)
  );
}

export function buildPrReviewRoleLanes(
  files: PrReviewFlowFile[]
): PrReviewRoleLane[] {
  const filesByRole = new Map<PrReviewFileRoleType, PrReviewFlowFile[]>();

  for (const file of sortPrReviewFlowFiles(files)) {
    const roleFiles = filesByRole.get(file.roleType) ?? [];
    roleFiles.push(file);
    filesByRole.set(file.roleType, roleFiles);
  }

  return ROLE_LANE_ORDER.flatMap((roleType) => {
    const roleFiles = filesByRole.get(roleType);
    if (!roleFiles?.length) {
      return [];
    }

    return [
      {
        roleType,
        ...ROLE_LANE_COPY[roleType],
        files: roleFiles
      }
    ];
  });
}

export function buildPrReviewFileColumnMap(files: PrReviewFlowFile[]) {
  return new Map(
    sortPrReviewFlowFiles(files).map((file, index) => [file.reviewFileId, index])
  );
}
