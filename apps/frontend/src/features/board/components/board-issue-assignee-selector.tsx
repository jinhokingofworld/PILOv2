"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoardIssueAssigneeOptionPayload } from "@/features/board/types";
import {
  filterAssigneeOptions,
  MAX_BOARD_ISSUE_ASSIGNEES,
  toggleAssigneeLogin
} from "@/features/board/utils/board-assignee-state";

type BoardIssueAssigneeSelectorProps = {
  disabled?: boolean;
  error: string | null;
  onChange: (logins: string[]) => void;
  onRetry: () => void;
  options: BoardIssueAssigneeOptionPayload[];
  status: "idle" | "loading" | "success" | "error";
  value: string[];
};

export function BoardIssueAssigneeSelector({
  disabled = false,
  error,
  onChange,
  onRetry,
  options,
  status,
  value
}: BoardIssueAssigneeSelectorProps) {
  const [query, setQuery] = useState("");
  const selectedLogins = useMemo(
    () => new Set(value.map((login) => login.toLowerCase())),
    [value]
  );
  const visibleOptions = useMemo(
    () => filterAssigneeOptions(options, value, query),
    [options, query, value]
  );
  const atAssigneeLimit = selectedLogins.size >= MAX_BOARD_ISSUE_ASSIGNEES;

  function toggleAssignee(login: string, checked: boolean) {
    onChange(toggleAssigneeLogin(value, login, checked).logins);
  }

  function renderOptions() {
    if (status === "loading") {
      return (
        <p className="text-xs text-muted-foreground">
          담당자 후보를 불러오는 중입니다.
        </p>
      );
    }

    if (status === "error") {
      return (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive">
            {error ?? "담당자 후보를 불러오지 못했습니다."}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onRetry}
          >
            다시 시도
          </Button>
        </div>
      );
    }

    if (status !== "success") {
      return null;
    }

    if (visibleOptions.length === 0) {
      return (
        <p className="text-xs text-muted-foreground">
          지정 가능한 담당자가 없습니다.
        </p>
      );
    }

    return (
      <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border bg-background p-2">
        {visibleOptions.map((option) => {
          const isSelected = selectedLogins.has(option.login.toLowerCase());
          return (
            <label
              key={option.login.toLowerCase()}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={disabled || (atAssigneeLimit && !isSelected)}
                onChange={(event) =>
                  toggleAssignee(option.login, event.currentTarget.checked)
                }
              />
              <span className="truncate">@{option.login}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Input
        value={query}
        disabled={disabled || status !== "success"}
        placeholder="담당자 검색"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {renderOptions()}
      {atAssigneeLimit ? (
        <p className="text-xs text-muted-foreground">
          담당자는 최대 {MAX_BOARD_ISSUE_ASSIGNEES}명까지 선택할 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}
