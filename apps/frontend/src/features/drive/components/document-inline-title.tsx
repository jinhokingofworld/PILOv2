"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

import styles from "./document-editor.module.css";

export function DocumentInlineTitle({
  name,
  onSave
}: {
  name: string;
  onSave: (name: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const saveInProgressRef = useRef(false);
  const [draftName, setDraftName] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftName(name);
  }, [name]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  async function saveName() {
    if (saveInProgressRef.current) {
      return;
    }

    const nextName = draftName.trim();
    if (!nextName) {
      setError("문서 이름을 입력해주세요.");
      return;
    }

    if (nextName.length > 255) {
      setError("문서 이름은 255자 이하로 입력해주세요.");
      return;
    }

    if (nextName === name) {
      setIsEditing(false);
      setError(null);
      return;
    }

    saveInProgressRef.current = true;
    setIsSaving(true);
    setError(null);

    try {
      await onSave(nextName);
      setIsEditing(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "문서 이름을 변경하지 못했습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <div className={styles.inlineTitleEditor}>
        <Input
          ref={inputRef}
          value={draftName}
          aria-label="문서 이름"
          aria-invalid={Boolean(error)}
          disabled={isSaving}
          className={styles.inlineTitleInput}
          onBlur={() => void saveName()}
          onChange={(event) => {
            setDraftName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraftName(name);
              setError(null);
              setIsEditing(false);
            }

            if (event.key === "Enter") {
              event.preventDefault();
              void saveName();
            }
          }}
        />
        {isSaving ? <Loader2 className="animate-spin" aria-label="문서 이름 저장 중" /> : null}
        {error ? <p className={styles.inlineTitleError}>{error}</p> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={styles.documentTitleButton}
      onClick={() => setIsEditing(true)}
    >
      {name}
    </button>
  );
}
