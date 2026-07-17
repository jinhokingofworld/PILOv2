from app.meeting_document_evidence import (
    DocumentTextChange,
    extract_document_text_changes,
    limit_document_change_evidence,
)


def document(*content: object) -> dict[str, object]:
    return {"type": "doc", "content": list(content)}


def paragraph(text: str) -> dict[str, object]:
    return {
        "type": "paragraph",
        "content": [{"type": "text", "text": text}],
    }


def test_extract_document_text_changes_returns_changed_text_without_attachment_atom() -> None:
    changes = extract_document_text_changes(
        document(paragraph("기존 내용")),
        document(
            paragraph("변경된 내용"),
            {"type": "driveFileAttachment", "attrs": {"driveItemId": "file-1"}},
        ),
    )

    assert changes == [DocumentTextChange("modified", "변경된 내용")]


def test_extract_document_text_changes_ignores_attachment_only_snapshot() -> None:
    assert (
        extract_document_text_changes(
            document(paragraph("회의록")),
            document(
                paragraph("회의록"),
                {"type": "driveFileAttachment", "attrs": {"driveItemId": "file-1"}},
            ),
        )
        == []
    )


def test_limit_document_change_evidence_bounds_document_and_total_changes() -> None:
    changes = [DocumentTextChange("added", f"변경 {index}") for index in range(13)]

    limited = limit_document_change_evidence(
        [("document-1", "PILO 기획서", "2026-07-17T01:00:00+00:00", changes)]
    )

    assert len(limited) == 1
    assert len(limited[0].changes) == 12
