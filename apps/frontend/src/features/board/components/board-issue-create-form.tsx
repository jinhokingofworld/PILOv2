"use client";

import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  BoardColumnPayload,
  CreateBoardIssueInput
} from "@/features/board/types";

type BoardIssueCreateFormProps = {
  columns: BoardColumnPayload[];
  disabled?: boolean;
  error?: string | null;
  isCreating?: boolean;
  onCreateIssue: (input: CreateBoardIssueInput) => Promise<void> | void;
};

const selectClassName =
  "h-9 rounded-[11px] border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm outline-none transition focus-visible:border-violet-300 focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-50";

export function BoardIssueCreateForm({
  columns,
  disabled = false,
  error = null,
  isCreating = false,
  onCreateIssue
}: BoardIssueCreateFormProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [columnId, setColumnId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!columns.length) {
      setColumnId("");
      return;
    }

    if (!columnId || !columns.some((column) => column.id === columnId)) {
      setColumnId(columns[0].id);
    }
  }, [columnId, columns]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setValidationError("제목을 입력해주세요.");
      return;
    }

    if (!columnId) {
      setValidationError("컬럼을 선택해주세요.");
      return;
    }

    setValidationError(null);

    await onCreateIssue({
      body,
      columnId,
      title: trimmedTitle
    });

    setTitle("");
    setBody("");
  }

  const submitDisabled = disabled || isCreating || !columns.length;

  return (
    <form
      className="board-issue-create-form flex flex-col gap-3 lg:flex-row lg:items-start"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="grid min-w-[220px] flex-1 gap-1.5 text-[12px] font-bold text-slate-500">
        제목
        <Input
          className="h-9 rounded-[11px] border-slate-200 bg-white text-[12.5px] shadow-sm"
          disabled={submitDisabled}
          placeholder="새 이슈 제목"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </label>

      <label className="grid min-w-[220px] flex-[1.2] gap-1.5 text-[12px] font-bold text-slate-500">
        본문
        <textarea
          className="min-h-9 rounded-[11px] border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-medium text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus-visible:border-violet-300 focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitDisabled}
          placeholder="본문 markdown"
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
        />
      </label>

      <label className="grid min-w-[180px] gap-1.5 text-[12px] font-bold text-slate-500">
        컬럼
        <select
          className={selectClassName}
          disabled={submitDisabled}
          value={columnId}
          onChange={(event) => setColumnId(event.currentTarget.value)}
        >
          <option value="">컬럼 선택</option>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex min-w-32 flex-col gap-1.5 pt-[22px]">
        <Button type="submit" size="lg" disabled={submitDisabled}>
          {isCreating ? <Loader2 className="animate-spin" /> : <Plus />}
          새 이슈
        </Button>
      </div>

      {validationError || error ? (
        <p className="basis-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
          {validationError ?? error}
        </p>
      ) : null}
    </form>
  );
}
