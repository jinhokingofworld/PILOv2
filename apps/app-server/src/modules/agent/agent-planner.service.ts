import { Injectable } from "@nestjs/common";
import type {
  AgentPlannerInput,
  AgentPlannerIntent,
  AgentPlannerMissingField,
  AgentPlannerResult,
  AgentPlannerToolName
} from "./types/agent-planner.types";
import type { AgentRiskLevel } from "./types/agent-tool.types";

@Injectable()
export class AgentPlannerService {
  plan(input: AgentPlannerInput): AgentPlannerResult {
    const prompt = input.prompt.trim();

    if (!prompt) {
      return this.unsupported("unknown_intent", "요청 내용을 입력해주세요.");
    }

    if (this.isBoardPrompt(prompt) && this.isBoardAssigneePrompt(prompt)) {
      return this.planBoard(prompt);
    }

    if (this.isHighRiskOrExcluded(prompt)) {
      return this.unsupported(
        "high_risk_or_excluded",
        "현재 Agent 1차 범위에서 실행할 수 없는 요청입니다."
      );
    }

    if (this.isCalendarPrompt(prompt)) {
      return this.planCalendar(prompt);
    }

    if (this.isMeetingControlPrompt(prompt)) {
      return this.planMeetingControl(prompt);
    }

    if (this.isMeetingReportPrompt(prompt)) {
      return this.planMeetingReport(prompt);
    }

    if (this.isBoardPrompt(prompt)) {
      return this.planBoard(prompt);
    }

    return this.unsupported(
      "unknown_intent",
      "현재 Agent가 처리할 수 있는 Workspace 요청으로 해석하지 못했습니다."
    );
  }

  private planCalendar(prompt: string): AgentPlannerResult {
    if (this.includesAny(prompt, ["수정", "변경", "바꿔", "옮겨"])) {
      return this.needsClarification({
        intent: "calendar.update_event",
        toolName: "update_calendar_event",
        riskLevel: "medium",
        missingFields: ["calendar_event_target"],
        message: "수정할 일정을 특정할 정보가 더 필요합니다."
      });
    }

    if (this.includesAny(prompt, ["만들", "생성", "추가", "잡아", "등록"])) {
      const missingFields: AgentPlannerMissingField[] = [];

      if (!this.hasCalendarTitle(prompt)) {
        missingFields.push("calendar_event_title");
      }

      if (!this.hasTimeExpression(prompt)) {
        missingFields.push("calendar_event_time");
      }

      if (missingFields.length > 0) {
        return this.needsClarification({
          intent: "calendar.create_event",
          toolName: "create_calendar_event",
          riskLevel: "medium",
          missingFields,
          message: "일정 생성을 위해 필요한 정보가 더 필요합니다."
        });
      }

      return this.toolCandidate({
        intent: "calendar.create_event",
        toolName: "create_calendar_event",
        riskLevel: "medium",
        message: "Calendar 일정 생성 후보로 분류했습니다."
      });
    }

    return this.toolCandidate({
      intent: "calendar.list_events",
      toolName: "list_calendar_events",
      riskLevel: "low",
      message: "Calendar 일정 조회 후보로 분류했습니다."
    });
  }

  private planMeetingReport(prompt: string): AgentPlannerResult {
    if (this.includesAny(prompt, ["요약", "정리", "action item", "액션 아이템"])) {
      return this.toolCandidate({
        intent: "meeting_report.summarize",
        toolName: "summarize_meeting_report",
        riskLevel: "low",
        message: "MeetingReport 요약 후보로 분류했습니다."
      });
    }

    return this.toolCandidate({
      intent: "meeting_report.list",
      toolName: "list_meeting_reports",
      riskLevel: "low",
      message: "MeetingReport 조회 후보로 분류했습니다."
    });
  }

  private planMeetingControl(prompt: string): AgentPlannerResult {
    if (this.includesAny(prompt, ["녹음 종료", "녹음 끝", "recording stop"])) {
      return this.needsClarification({
        intent: "meeting.end_recording",
        toolName: "end_meeting_recording",
        riskLevel: "medium",
        missingFields: ["meeting"],
        message: "녹음을 종료할 회의를 특정해야 합니다."
      });
    }
    if (this.includesAny(prompt, ["녹음 시작", "recording start"])) {
      return this.needsClarification({
        intent: "meeting.start_recording",
        toolName: "start_meeting_recording",
        riskLevel: "medium",
        missingFields: ["meeting"],
        message: "녹음을 시작할 회의를 특정해야 합니다."
      });
    }
    if (this.includesAny(prompt, ["나가", "퇴장", "leave"])) {
      return this.needsClarification({
        intent: "meeting.leave",
        toolName: "leave_meeting",
        riskLevel: "low",
        missingFields: ["meeting"],
        message: "나갈 회의를 특정해야 합니다."
      });
    }
    if (this.includesAny(prompt, ["참여", "입장", "들어가", "join"])) {
      return this.needsClarification({
        intent: "meeting.join",
        toolName: "join_meeting",
        riskLevel: "medium",
        missingFields: ["meeting"],
        message: "참여할 회의를 특정해야 합니다."
      });
    }
    return this.needsClarification({
      intent: "meeting.start",
      toolName: "start_meeting_in_room",
      riskLevel: "medium",
      missingFields: ["meeting_room"],
      message: "회의를 시작할 방을 특정해야 합니다."
    });
  }

  private planBoard(prompt: string): AgentPlannerResult {
    if (this.isBoardAssigneePrompt(prompt)) {
      const missingFields: AgentPlannerMissingField[] = [];
      if (!this.hasBoardIssueReference(prompt)) {
        missingFields.push("board_issue");
      }
      if (!this.hasBoardAssigneeReference(prompt)) {
        missingFields.push("board_assignee");
      }
      if (missingFields.length > 0) {
        return this.needsClarification({
          intent: "board.assign_issue",
          toolName: "assign_board_issue_safely",
          riskLevel: "medium",
          missingFields,
          message: "Board issue 담당자 변경에 필요한 정보가 더 필요합니다."
        });
      }
      return this.toolCandidate({
        intent: "board.assign_issue",
        toolName: "assign_board_issue_safely",
        riskLevel: "medium",
        message: "Board issue 담당자 변경 후보로 분류했습니다."
      });
    }

    if (
      this.includesAny(prompt, ["최신", "freshness", "동기화 상태", "진단"])
    ) {
      return this.toolCandidate({
        intent: "board.diagnose_freshness",
        toolName: "diagnose_board_freshness",
        riskLevel: "low",
        message: "Board 최신성 진단 후보로 분류했습니다."
      });
    }

    if (this.includesAny(prompt, ["브리핑", "전체 현황", "보드 현황", "board 현황"])) {
      return this.toolCandidate({
        intent: "board.get_briefing",
        toolName: "get_board_briefing",
        riskLevel: "low",
        message: "Board 브리핑 후보로 분류했습니다."
      });
    }

    if (
      this.includesAny(prompt, [
        "현재 board",
        "active board",
        "어느 board",
        "어떤 board",
        "board가 무엇",
        "보드가 무엇"
      ])
    ) {
      return this.toolCandidate({
        intent: "board.resolve_context",
        toolName: "resolve_board_context",
        riskLevel: "low",
        message: "Board 문맥 확인 후보로 분류했습니다."
      });
    }

    if (
      this.includesAny(prompt, ["생성", "만들", "추가", "등록"]) &&
      this.includesAny(prompt, ["이슈", "issue"])
    ) {
      return this.toolCandidate({
        intent: "board.create_issue",
        toolName: "create_board_issue",
        riskLevel: "medium",
        message: "Board issue 생성 후보로 분류했습니다."
      });
    }

    if (
      this.hasBoardIssueReference(prompt) &&
      this.includesAny(prompt, ["상세", "문맥", "맥락", "관련 pr", "pull request"])
    ) {
      return this.toolCandidate({
        intent: "board.get_issue_context",
        toolName: "get_board_issue_context",
        riskLevel: "low",
        message: "Board issue 문맥 조회 후보로 분류했습니다."
      });
    }

    if (
      this.includesAny(prompt, [
        "이동",
        "옮겨",
        "상태",
        "진행중",
        "진행 중",
        "완료",
        "in progress",
        "done"
      ])
    ) {
      const missingFields: AgentPlannerMissingField[] = [];

      if (!this.hasBoardIssueReference(prompt)) {
        missingFields.push("board_issue");
      }

      if (!this.hasBoardColumnReference(prompt)) {
        missingFields.push("board_column");
      }

      if (missingFields.length > 0) {
        return this.needsClarification({
          intent: "board.move_issue_status",
          toolName: "move_board_issue_status",
          riskLevel: "medium",
          missingFields,
          message: "Board issue 상태 이동에 필요한 정보가 더 필요합니다."
        });
      }

      return this.toolCandidate({
        intent: "board.move_issue_status",
        toolName: "move_board_issue_status",
        riskLevel: "medium",
        message: "Board issue 상태 이동 후보로 분류했습니다."
      });
    }

    return this.toolCandidate({
      intent: "board.search_issues",
      toolName: "search_board_issues",
      riskLevel: "low",
      message: "Board issue 검색 후보로 분류했습니다."
    });
  }

  private toolCandidate(input: {
    intent: Exclude<AgentPlannerIntent, "unsupported">;
    toolName: AgentPlannerToolName;
    riskLevel: AgentRiskLevel;
    message: string;
  }): AgentPlannerResult {
    const executionMode =
      input.riskLevel === "medium" ? "confirmation_required" : "auto";

    return {
      status: "tool_candidate",
      intent: input.intent,
      message: input.message,
      toolCandidate: {
        toolName: input.toolName,
        riskLevel: input.riskLevel,
        executionMode,
        requiresConfirmation: executionMode === "confirmation_required",
        inputSummary: {},
        toolInputValidation: "tool_adapter_required"
      }
    };
  }

  private needsClarification(input: {
    intent: Exclude<AgentPlannerIntent, "unsupported">;
    toolName: AgentPlannerToolName;
    riskLevel: AgentRiskLevel;
    missingFields: AgentPlannerMissingField[];
    message: string;
  }): AgentPlannerResult {
    const result = this.toolCandidate(input);

    return {
      ...result,
      status: "needs_clarification",
      missingFields: input.missingFields
    };
  }

  private unsupported(
    unsupportedReason: NonNullable<AgentPlannerResult["unsupportedReason"]>,
    message: string
  ): AgentPlannerResult {
    return {
      status: "unsupported",
      intent: "unsupported",
      message,
      unsupportedReason
    };
  }

  private isCalendarPrompt(prompt: string): boolean {
    return this.includesAny(prompt, ["일정", "캘린더", "calendar"]);
  }

  private isMeetingReportPrompt(prompt: string): boolean {
    return this.includesAny(prompt, ["회의록", "meeting report"]);
  }

  private isMeetingControlPrompt(prompt: string): boolean {
    return this.includesAny(prompt, [
      "회의 시작",
      "회의 참여",
      "회의 입장",
      "회의 나가",
      "회의 퇴장",
      "녹음 시작",
      "녹음 종료",
      "meeting",
      "recording"
    ]);
  }

  private isBoardPrompt(prompt: string): boolean {
    return this.includesAny(prompt, ["이슈", "issue", "보드", "board"]);
  }

  private isHighRiskOrExcluded(prompt: string): boolean {
    return this.includesAny(prompt, [
      "삭제",
      "지워",
      "제거",
      "pr review 제출",
      "리뷰 제출",
      "라벨 변경",
      "label 변경",
      "마일스톤 변경",
      "milestone 변경",
      "due date 변경",
      "회의록 재생성"
    ]);
  }

  private hasCalendarTitle(prompt: string): boolean {
    return this.includesAny(prompt, [
      "회의",
      "미팅",
      "면담",
      "리뷰",
      "데모",
      "공유",
      "점검",
      "발표",
      "약속"
    ]);
  }

  private hasTimeExpression(prompt: string): boolean {
    return /(\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두)\s*시/.test(
      prompt
    );
  }

  private hasBoardIssueReference(prompt: string): boolean {
    return /#\d+|이슈\s*\d+|issue\s*#?\d+/i.test(prompt);
  }

  private hasBoardColumnReference(prompt: string): boolean {
    return this.includesAny(prompt, [
      "todo",
      "to do",
      "in progress",
      "진행중",
      "진행 중",
      "done",
      "완료",
      "review",
      "리뷰"
    ]);
  }

  private isBoardAssigneePrompt(prompt: string): boolean {
    return (
      this.includesAny(prompt, ["담당자", "assignee"]) &&
      this.includesAny(prompt, ["추가", "배정", "지정", "제거", "해제", "빼"])
    );
  }

  private hasBoardAssigneeReference(prompt: string): boolean {
    return /(?:담당자|assignee)(?:로|에|에서)?\s*[a-z0-9_-]+|[a-z0-9_-]+(?:을|를)?\s*(?:담당자|assignee)/i.test(
      prompt
    );
  }

  private includesAny(value: string, needles: string[]): boolean {
    const normalized = value.toLowerCase();

    return needles.some((needle) => normalized.includes(needle.toLowerCase()));
  }
}
