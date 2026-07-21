# Calendar Month UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 월간 Calendar의 날짜별 일정 추가 상호작용, 월 선택, 일정 표시 밀도와 모달 디자인을 홈 화면의 shadcn 디자인 체계에 맞춘다.

**Architecture:** Calendar API 계약은 그대로 두고 `calendar-panel.tsx`의 화면 상태와 렌더링을 변경한다. 월/연도 선택은 Calendar 도메인 내부의 독립 컴포넌트로 분리하고, 날짜 범위 계산과 지원 연도 검증은 순수 유틸리티로 분리해 실제 경계 동작을 테스트한다.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, Base UI 기반 공통 컴포넌트, Node test runner

## Global Constraints

- Calendar API endpoint, request, response, status code를 변경하지 않는다.
- App Server와 DB schema를 변경하지 않는다.
- `apps/frontend/src/components/ui/**` 공통 컴포넌트는 변경하지 않는다.
- UI 색상은 shadcn 시맨틱 토큰을 사용하고, 일정 자체의 사용자 선택 색상만 동적 inline style로 유지한다.
- 일정 바를 클릭하면 상세 모달을 열고, 날짜 칸 빈 영역의 더블 클릭만 일정 추가로 처리한다.

---

### Task 1: 날짜 선택과 월 이동 상호작용

**Files:**
- Create: `apps/frontend/src/features/calendar/components/calendar-month-picker.tsx`
- Modify: `apps/frontend/src/features/calendar/components/calendar-panel.tsx`
- Test: `apps/frontend/scripts/calendar/test.mjs`

**Interfaces:**
- Consumes: 현재 표시 중인 `monthDate: Date`, `onMonthChange(nextMonth: Date)`
- Produces: `CalendarMonthPicker`와 선택 날짜 기반 `openCreateDialog(date)` 동작

- [ ] **Step 1: 상호작용 계약 테스트를 추가한다**

  `calendar-panel.tsx`에 선택 날짜 전용 추가 버튼과 빈 영역 `onDoubleClick`, `CalendarMonthPicker`가 있어야 하며 기존 일정 개수 문구는 없어야 한다고 검증한다.

- [ ] **Step 2: Calendar 집중 테스트가 새 계약 때문에 실패하는지 확인한다**

  Run: `node scripts/calendar/test.mjs`
  Expected: 날짜 추가 버튼 또는 `CalendarMonthPicker`가 없어 FAIL

- [ ] **Step 3: 월 선택 컴포넌트와 날짜 추가 상호작용을 구현한다**

  shadcn `Popover`, `Select`, `Input`, `Button`으로 1900~2100년 범위의 연도와 월을 선택하고 검증된 월 시작일을 `onMonthChange`에 전달한다. 날짜 칸 배경 버튼의 단일 클릭은 선택만 하고 더블 클릭은 해당 날짜로 추가 모달을 연다. 일정 버튼은 기존 상세 모달 동작을 유지한다.

- [ ] **Step 4: 집중 테스트 통과를 확인한다**

  Run: `node scripts/calendar/test.mjs`
  Expected: PASS

### Task 2: 일정 높이·간격과 연속 일정 선택 표시

**Files:**
- Modify: `apps/frontend/src/features/calendar/components/calendar-panel.tsx`
- Test: `apps/frontend/scripts/calendar/test.mjs`

**Interfaces:**
- Consumes: `CalendarEvent`, `CalendarEventBarSegment`, `getCalendarDateBarLayout`
- Produces: 동일한 `28px` 일정 높이와 `4px` lane 간격, 완전한 날짜 선택 outline

- [ ] **Step 1: 레이아웃 회귀 테스트를 추가한다**

  종일·일반·연속 일정이 공통 `h-7` 높이를 사용하고, lane 간격이 `4px`이며, 날짜 칸 border를 연속 일정 때문에 제거하지 않는다고 검증한다.

- [ ] **Step 2: 기존 레이아웃에서 테스트가 실패하는지 확인한다**

  Run: `node scripts/calendar/test.mjs`
  Expected: 종일 칩 높이 또는 lane 간격 조건에서 FAIL

- [ ] **Step 3: 레이아웃 원인을 수정한다**

  종일·일반 칩과 연속 바를 `h-7`로 통일하고 lane pitch를 `32px`로 변경한다. 날짜 카드는 항상 좌우 border와 radius를 유지하며, 선택 표시는 inset ring overlay로 이벤트 바 위에 그린다. 연속 바는 실제 시작·끝에만 수평 여백과 radius를 적용한다.

- [ ] **Step 4: 집중 테스트 통과를 확인한다**

  Run: `node scripts/calendar/test.mjs`
  Expected: PASS

### Task 3: Home 스타일과 shadcn 모달 통일

**Files:**
- Modify: `apps/frontend/src/features/calendar/components/calendar-panel.tsx`
- Test: `apps/frontend/scripts/calendar/test.mjs`

**Interfaces:**
- Consumes: 공통 `Card`, `Dialog`, `Input`, `Textarea`, `Switch`, `Button`
- Produces: 홈 화면과 동일한 semantic surface 및 공통 Dialog primitives를 사용하는 Calendar 화면

- [ ] **Step 1: 디자인 시스템 계약 테스트를 추가한다**

  Calendar가 직접 `@base-ui/react/dialog`를 사용하지 않고 shadcn Dialog, Card, Textarea, Switch를 사용하며 이전 `bg-black/35` backdrop을 포함하지 않는다고 검증한다.

- [ ] **Step 2: 기존 직접 Dialog 구현에서 테스트가 실패하는지 확인한다**

  Run: `node scripts/calendar/test.mjs`
  Expected: 직접 Base UI import 또는 backdrop 조건에서 FAIL

- [ ] **Step 3: Calendar 화면과 모달을 공통 컴포넌트로 교체한다**

  월간 화면은 홈과 같은 `bg-background`, `bg-card`, `border-border`, `shadow-sm`, rounded card 구성을 사용한다. 일정 생성·상세·수정·삭제·목록 모달은 공통 Dialog 구조와 semantic token을 사용하고 폼 checkbox/textarea를 Switch/Textarea로 교체한다.

- [ ] **Step 4: 검증과 self-review를 수행한다**

  Run: `node scripts/calendar/test.mjs`, `npm run format:check`, `npm run lint`, `npm test`, `npm run build`, `git diff --check`
  Expected: 모든 명령 exit 0

- [ ] **Step 5: 의도한 파일만 커밋하고 PR을 생성한다**

  `git diff`와 공통 영역 문서를 다시 확인한 뒤 Issue #1703을 연결한 커밋을 push하고 `dev` 대상 Ready PR을 생성한다.
