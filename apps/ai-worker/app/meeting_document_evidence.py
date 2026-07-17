from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from difflib import SequenceMatcher

MAX_DOCUMENT_EVIDENCE_ITEMS = 8
MAX_CHANGES_PER_DOCUMENT = 12
MAX_DOCUMENT_CHANGES = 48
MAX_DOCUMENT_EVIDENCE_BYTES = 8_000
MAX_DOCUMENT_CHANGE_TEXT_BYTES = 500


@dataclass(frozen=True)
class DocumentTextChange:
    kind: str
    text: str


@dataclass(frozen=True)
class DocumentChangeEvidence:
    document_id: str
    title: str
    occurred_at: str
    changes: list[DocumentTextChange]


def extract_document_text_changes(before: object, after: object) -> list[DocumentTextChange]:
    before_blocks = flatten_tiptap_text_blocks(before)
    after_blocks = flatten_tiptap_text_blocks(after)
    changes: list[DocumentTextChange] = []

    for tag, before_start, before_end, after_start, after_end in SequenceMatcher(
        a=before_blocks,
        b=after_blocks,
        autojunk=False,
    ).get_opcodes():
        if tag == "equal":
            continue
        if tag == "delete":
            changes.extend(
                DocumentTextChange("deleted", text)
                for text in before_blocks[before_start:before_end]
            )
            continue
        if tag == "insert":
            changes.extend(
                DocumentTextChange("added", text) for text in after_blocks[after_start:after_end]
            )
            continue

        before_slice = before_blocks[before_start:before_end]
        after_slice = after_blocks[after_start:after_end]
        paired_count = min(len(before_slice), len(after_slice))
        changes.extend(DocumentTextChange("modified", text) for text in after_slice[:paired_count])
        changes.extend(DocumentTextChange("deleted", text) for text in before_slice[paired_count:])
        changes.extend(DocumentTextChange("added", text) for text in after_slice[paired_count:])

    return _dedupe_changes(changes)


def flatten_tiptap_text_blocks(value: object) -> list[str]:
    if not isinstance(value, Mapping):
        return []
    content = value.get("content")
    if not isinstance(content, list):
        return []
    return _flatten_nodes(content)


def build_document_change_evidence(
    rows: Iterable[Mapping[str, object]],
) -> list[DocumentChangeEvidence]:
    grouped: dict[str, DocumentChangeEvidence] = {}

    for row in rows:
        document_id = _as_nonempty_text(row.get("document_id"))
        title = _as_nonempty_text(row.get("title"))
        occurred_at = _as_nonempty_text(row.get("occurred_at"))
        action = _as_nonempty_text(row.get("action"))
        if not document_id or not title or not occurred_at or not action:
            continue

        evidence = grouped.get(document_id)
        if evidence is None:
            evidence = DocumentChangeEvidence(document_id, title, occurred_at, [])
            grouped[document_id] = evidence

        if action == "document_renamed":
            previous_title = _as_nonempty_text(row.get("previous_title"))
            renamed_title = _as_nonempty_text(row.get("renamed_title"))
            if previous_title and renamed_title and previous_title != renamed_title:
                evidence.changes.append(
                    DocumentTextChange("renamed", f"{previous_title} -> {renamed_title}")
                )
            continue

        evidence.changes.extend(
            extract_document_text_changes(
                row.get("before_content_json"),
                row.get("after_content_json"),
            )
        )

    candidates = [
        (item.document_id, item.title, item.occurred_at, _dedupe_changes(item.changes))
        for item in grouped.values()
        if item.changes
    ]
    return limit_document_change_evidence(candidates)


def limit_document_change_evidence(
    candidates: Iterable[tuple[str, str, str, list[DocumentTextChange]]],
) -> list[DocumentChangeEvidence]:
    evidence: list[DocumentChangeEvidence] = []
    total_bytes = 0
    total_changes = 0

    for document_id, title, occurred_at, changes in candidates:
        if len(evidence) >= MAX_DOCUMENT_EVIDENCE_ITEMS or total_changes >= MAX_DOCUMENT_CHANGES:
            break

        bounded_changes: list[DocumentTextChange] = []
        for change in changes:
            if (
                len(bounded_changes) >= MAX_CHANGES_PER_DOCUMENT
                or total_changes >= MAX_DOCUMENT_CHANGES
            ):
                break
            text = _truncate_utf8(change.text, MAX_DOCUMENT_CHANGE_TEXT_BYTES)
            if not text:
                continue
            serialized_size = len(f"{change.kind}:{text}".encode())
            if total_bytes + serialized_size > MAX_DOCUMENT_EVIDENCE_BYTES:
                break
            bounded_changes.append(DocumentTextChange(change.kind, text))
            total_bytes += serialized_size
            total_changes += 1

        if bounded_changes:
            evidence.append(
                DocumentChangeEvidence(document_id, title, occurred_at, bounded_changes)
            )

        if total_bytes >= MAX_DOCUMENT_EVIDENCE_BYTES:
            break

    return evidence


def format_document_change_evidence(evidence: list[DocumentChangeEvidence]) -> str:
    if not evidence:
        return "없음"

    labels = {
        "added": "추가",
        "modified": "수정",
        "deleted": "삭제",
        "renamed": "이름 변경",
    }
    lines: list[str] = []
    for index, item in enumerate(evidence):
        lines.append(f"[{index}] 문서: {item.title}")
        lines.extend(f"- {labels[change.kind]}: {change.text}" for change in item.changes)
    return "\n".join(lines)


def _flatten_nodes(nodes: list[object], prefix: str = "") -> list[str]:
    blocks: list[str] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        node_type = node.get("type")
        content = node.get("content")
        children = content if isinstance(content, list) else []

        if node_type in {"paragraph", "heading", "blockquote", "codeBlock"}:
            text = _normalize_text(_text_content(children))
            if text:
                blocks.append(f"{prefix}{text}")
            continue
        if node_type in {"bulletList", "orderedList"}:
            blocks.extend(_flatten_nodes(children, "- "))
            continue
        if node_type == "taskList":
            blocks.extend(_flatten_nodes(children, "- [ ] "))
            continue
        if node_type == "taskItem":
            attrs = node.get("attrs")
            checked = isinstance(attrs, Mapping) and attrs.get("checked") is True
            blocks.extend(_flatten_nodes(children, "- [x] " if checked else "- [ ] "))
            continue
        blocks.extend(_flatten_nodes(children, prefix))
    return blocks


def _text_content(nodes: list[object]) -> str:
    parts: list[str] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        if node.get("type") == "text" and isinstance(node.get("text"), str):
            parts.append(node["text"])
            continue
        content = node.get("content")
        if isinstance(content, list):
            parts.append(_text_content(content))
    return "".join(parts)


def _dedupe_changes(changes: Iterable[DocumentTextChange]) -> list[DocumentTextChange]:
    deduped: list[DocumentTextChange] = []
    seen: set[tuple[str, str]] = set()
    for change in changes:
        text = _normalize_text(change.text)
        key = (change.kind, text)
        if not text or key in seen:
            continue
        seen.add(key)
        deduped.append(DocumentTextChange(change.kind, text))
    return deduped


def _normalize_text(value: str) -> str:
    return " ".join(value.split())


def _as_nonempty_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _truncate_utf8(value: str, max_bytes: int) -> str:
    encoded = value.encode("utf-8")
    if len(encoded) <= max_bytes:
        return value
    return encoded[: max_bytes - 3].decode("utf-8", errors="ignore").rstrip() + "..."
