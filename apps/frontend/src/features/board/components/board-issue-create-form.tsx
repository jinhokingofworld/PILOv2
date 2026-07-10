"use client";

import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  BoardColumnPayload,
  CreateBoardIssueCommand
} from "@/features/board/types";
import { resolveBoardIssueCreateIdempotencyKey } from "@/features/board/utils/board-issue-create-idempotency";

type BoardIssueCreateFormProps = {
  columns: BoardColumnPayload[];
  disabled?: boolean;
  error?: string | null;
  isCreating?: boolean;
  onCreateIssue: (
    input: CreateBoardIssueCommand
  ) => Promise<boolean | void> | boolean | void;
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
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!columns.length) {
      setColumnId("");
      setIdempotencyKey(null);
      return;
    }

    if (!columnId || !columns.some((column) => column.id === columnId)) {
      setColumnId(columns[0].id);
      setIdempotencyKey(null);
    }
  }, [columnId, columns]);

  function handleTitleChange(value: string) {
    setTitle(value);
    setIdempotencyKey(null);
  }

  function handleBodyChange(value: string) {
    setBody(value);
    setIdempotencyKey(null);
  }

  function handleColumnChange(value: string) {
    setColumnId(value);
    setIdempotencyKey(null);
  }

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

    const nextIdempotencyKey = resolveBoardIssueCreateIdempotencyKey(
      idempotencyKey
    );
    setIdempotencyKey(nextIdempotencyKey);

    const created = await onCreateIssue({
      body,
      columnId,
      idempotencyKey: nextIdempotencyKey,
      title: trimmedTitle
    });

    if (created === false) {
      return;
    }

    setTitle("");
    setBody("");
    setIdempotencyKey(null);
  }

  const submitDisabled = disabled || isCreating || !columns.length;

  return (
    <form
      className="board-issue-create-form grid gap-4"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="grid gap-1.5 text-[12px] font-bold text-slate-500">
        제목
        <Input
          className="h-9 rounded-[11px] border-slate-200 bg-white text-[12.5px] shadow-sm"
          disabled={submitDisabled}
          placeholder="새 이슈 제목"
          value={title}
          onChange={(event) => handleTitleChange(event.currentTarget.value)}
        />
      </label>

      <label className="grid gap-1.5 text-[12px] font-bold text-slate-500">
        본문
        <textarea
          className="min-h-36 resize-y rounded-[11px] border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-medium text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus-visible:border-violet-300 focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitDisabled}
          placeholder="본문 markdown"
          value={body}
          onChange={(event) => handleBodyChange(event.currentTarget.value)}
        />
      </label>

      <label className="grid gap-1.5 text-[12px] font-bold text-slate-500">
        컬럼
        <select
          className={selectClassName}
          disabled={submitDisabled}
          value={columnId}
          onChange={(event) => handleColumnChange(event.currentTarget.value)}
        >
          <option value="">컬럼 선택</option>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex justify-end">
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
