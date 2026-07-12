from __future__ import annotations

from dataclasses import dataclass

PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION = "pr-review-semantic-graph:v1"
PR_REVIEW_ROLE_OVERRIDE_CONFIDENCE_THRESHOLD = 85
PR_REVIEW_FILE_ROLES = {
    "entry",
    "core_logic",
    "api_contract",
    "ui_state",
    "verification",
    "support",
    "unknown",
}
PR_REVIEW_RELATION_TYPES = {
    "depends_on",
    "tests",
    "uses_api",
    "passes_data_to",
    "supports",
}
PR_REVIEW_RELATION_SOURCES = {"rule", "ai", "hybrid"}


@dataclass(frozen=True)
class SemanticGraphFileInput:
    file_path: str
    role_type: str
    confidence: int
    evidence: str
    role_override_allowed: bool


@dataclass(frozen=True)
class SemanticGraphRelationInput:
    key: str
    from_file_path: str
    to_file_path: str
    relation_type: str
    source: str
    confidence: int
    evidence: str


@dataclass(frozen=True)
class SemanticGraphFlowInput:
    key: str
    title: str
    file_paths: tuple[str, ...]
    relation_keys: tuple[str, ...]
    fallback: bool


@dataclass(frozen=True)
class SemanticGraphInput:
    files: tuple[SemanticGraphFileInput, ...]
    relations: tuple[SemanticGraphRelationInput, ...]
    flows: tuple[SemanticGraphFlowInput, ...]


@dataclass(frozen=True)
class SemanticGraphFileOutput:
    file_path: str
    role_type: str
    role_reason: str


@dataclass(frozen=True)
class SemanticGraphRelationOutput:
    candidate_key: str | None
    from_file_path: str
    to_file_path: str
    relation_type: str
    reason: str


@dataclass(frozen=True)
class SemanticGraphFlowOutput:
    candidate_key: str
    title: str
    description: str
    review_order: tuple[str, ...]


@dataclass(frozen=True)
class SemanticGraphOutput:
    files: tuple[SemanticGraphFileOutput, ...]
    relations: tuple[SemanticGraphRelationOutput, ...]
    flows: tuple[SemanticGraphFlowOutput, ...]


def parse_semantic_graph_input(
    data: dict[str, object],
    known_file_paths: set[str],
) -> SemanticGraphInput | None:
    version = data.get("graphSchemaVersion")
    graph_value = data.get("semanticGraph")
    if version is None and graph_value is None:
        return None
    if version != PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION or not isinstance(graph_value, dict):
        raise ValueError("Invalid semantic graph input version")

    files = _parse_input_files(graph_value.get("files"))
    if {file.file_path for file in files} != known_file_paths:
        raise ValueError("Semantic graph input files do not match changed files")

    relations = _parse_input_relations(graph_value.get("relations"), known_file_paths)
    relation_by_key = {relation.key: relation for relation in relations}
    flows = _parse_input_flows(graph_value.get("flows"), known_file_paths, relation_by_key)
    return SemanticGraphInput(files=files, relations=relations, flows=flows)


def parse_semantic_graph_output(
    value: dict[str, object],
    graph_input: SemanticGraphInput | None,
) -> SemanticGraphOutput | None:
    version = value.get("graphSchemaVersion")
    graph_value = value.get("semanticGraph")
    if graph_input is None:
        if version is not None or graph_value is not None:
            raise ValueError("Legacy analysis output must not include semantic graph")
        return None
    if version != PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION or not isinstance(graph_value, dict):
        raise ValueError("Invalid semantic graph output version")

    input_file_by_path = {file.file_path: file for file in graph_input.files}
    files = _parse_output_files(graph_value.get("files"), input_file_by_path)
    relations = _parse_output_relations(
        graph_value.get("relations"),
        set(input_file_by_path),
        {relation.key for relation in graph_input.relations},
    )
    flows = _parse_output_flows(graph_value.get("flows"), graph_input.flows)
    return SemanticGraphOutput(files=files, relations=relations, flows=flows)


def semantic_graph_prompt_input(graph: SemanticGraphInput) -> dict[str, object]:
    return {
        "schemaVersion": PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
        "rolePolicy": {
            "overrideConfidenceThreshold": PR_REVIEW_ROLE_OVERRIDE_CONFIDENCE_THRESHOLD,
            "rule": (
                "Preserve roleType when roleOverrideAllowed is false. Roles with lower "
                "confidence or unknown may be corrected with a concise roleReason."
            ),
        },
        "files": [
            {
                "filePath": file.file_path,
                "roleType": file.role_type,
                "confidence": file.confidence,
                "evidence": file.evidence,
                "roleOverrideAllowed": file.role_override_allowed,
            }
            for file in graph.files
        ],
        "relations": [
            {
                "key": relation.key,
                "fromFilePath": relation.from_file_path,
                "toFilePath": relation.to_file_path,
                "relationType": relation.relation_type,
                "source": relation.source,
                "confidence": relation.confidence,
                "evidence": relation.evidence,
            }
            for relation in graph.relations
        ],
        "flows": [
            {
                "key": flow.key,
                "title": flow.title,
                "filePaths": list(flow.file_paths),
                "relationKeys": list(flow.relation_keys),
                "fallback": flow.fallback,
            }
            for flow in graph.flows
        ],
    }


def semantic_graph_output_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["files", "relations", "flows"],
        "properties": {
            "files": {
                "type": "array",
                "items": _closed_object(
                    ["filePath", "roleType", "roleReason"],
                    {
                        "filePath": {"type": "string"},
                        "roleType": {
                            "type": "string",
                            "enum": sorted(PR_REVIEW_FILE_ROLES),
                        },
                        "roleReason": {"type": "string"},
                    },
                ),
            },
            "relations": {
                "type": "array",
                "items": _closed_object(
                    [
                        "candidateKey",
                        "fromFilePath",
                        "toFilePath",
                        "relationType",
                        "reason",
                    ],
                    {
                        "candidateKey": {"type": ["string", "null"]},
                        "fromFilePath": {"type": "string"},
                        "toFilePath": {"type": "string"},
                        "relationType": {
                            "type": "string",
                            "enum": sorted(PR_REVIEW_RELATION_TYPES),
                        },
                        "reason": {"type": "string"},
                    },
                ),
            },
            "flows": {
                "type": "array",
                "items": _closed_object(
                    ["candidateKey", "title", "description", "reviewOrder"],
                    {
                        "candidateKey": {"type": "string"},
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "reviewOrder": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                ),
            },
        },
    }


def serialize_semantic_graph_output(graph: SemanticGraphOutput) -> dict[str, object]:
    return {
        "files": [
            {
                "filePath": file.file_path,
                "roleType": file.role_type,
                "roleReason": file.role_reason,
            }
            for file in graph.files
        ],
        "relations": [
            {
                "candidateKey": relation.candidate_key,
                "fromFilePath": relation.from_file_path,
                "toFilePath": relation.to_file_path,
                "relationType": relation.relation_type,
                "reason": relation.reason,
            }
            for relation in graph.relations
        ],
        "flows": [
            {
                "candidateKey": flow.candidate_key,
                "title": flow.title,
                "description": flow.description,
                "reviewOrder": list(flow.review_order),
            }
            for flow in graph.flows
        ],
    }


def _parse_input_files(value: object) -> tuple[SemanticGraphFileInput, ...]:
    items = _require_list(value, "semantic graph files")
    files: list[SemanticGraphFileInput] = []
    seen_paths: set[str] = set()
    for item in items:
        record = _require_dict(item, "semantic graph file")
        file_path = _require_string(record, "filePath")
        if file_path in seen_paths:
            raise ValueError("Duplicate semantic graph file")
        seen_paths.add(file_path)
        role_type = _require_one_of(record, "roleType", PR_REVIEW_FILE_ROLES)
        confidence = _require_confidence(record, "confidence")
        override_allowed = _require_bool(record, "roleOverrideAllowed")
        expected_override = (
            role_type == "unknown" or confidence < PR_REVIEW_ROLE_OVERRIDE_CONFIDENCE_THRESHOLD
        )
        if override_allowed != expected_override:
            raise ValueError("Invalid semantic graph role override policy")
        files.append(
            SemanticGraphFileInput(
                file_path=file_path,
                role_type=role_type,
                confidence=confidence,
                evidence=_require_string(record, "evidence"),
                role_override_allowed=override_allowed,
            )
        )
    return tuple(files)


def _parse_input_relations(
    value: object, known_paths: set[str]
) -> tuple[SemanticGraphRelationInput, ...]:
    items = _require_list(value, "semantic graph relations")
    relations: list[SemanticGraphRelationInput] = []
    seen_keys: set[str] = set()
    for item in items:
        record = _require_dict(item, "semantic graph relation")
        key = _require_string(record, "key")
        from_path = _require_string(record, "fromFilePath")
        to_path = _require_string(record, "toFilePath")
        if key in seen_keys or from_path == to_path:
            raise ValueError("Invalid semantic graph relation identity")
        if from_path not in known_paths or to_path not in known_paths:
            raise ValueError("Unknown semantic graph relation endpoint")
        seen_keys.add(key)
        relations.append(
            SemanticGraphRelationInput(
                key=key,
                from_file_path=from_path,
                to_file_path=to_path,
                relation_type=_require_one_of(record, "relationType", PR_REVIEW_RELATION_TYPES),
                source=_require_one_of(record, "source", PR_REVIEW_RELATION_SOURCES),
                confidence=_require_confidence(record, "confidence"),
                evidence=_require_string(record, "evidence"),
            )
        )
    return tuple(relations)


def _parse_input_flows(
    value: object,
    known_paths: set[str],
    relation_by_key: dict[str, SemanticGraphRelationInput],
) -> tuple[SemanticGraphFlowInput, ...]:
    items = _require_list(value, "semantic graph flows")
    flows: list[SemanticGraphFlowInput] = []
    seen_keys: set[str] = set()
    assigned_paths: set[str] = set()
    for item in items:
        record = _require_dict(item, "semantic graph flow")
        key = _require_string(record, "key")
        file_paths = _require_string_tuple(record, "filePaths")
        relation_keys = _require_string_tuple(record, "relationKeys", allow_empty=True)
        if key in seen_keys or len(file_paths) != len(set(file_paths)):
            raise ValueError("Invalid semantic graph flow identity")
        if not set(file_paths) <= known_paths or assigned_paths.intersection(file_paths):
            raise ValueError("Invalid semantic graph flow membership")
        if not set(relation_keys) <= set(relation_by_key):
            raise ValueError("Unknown semantic graph flow relation")
        for relation_key in relation_keys:
            relation = relation_by_key[relation_key]
            if relation.from_file_path not in file_paths or relation.to_file_path not in file_paths:
                raise ValueError("Semantic graph flow relation is outside the flow")
        seen_keys.add(key)
        assigned_paths.update(file_paths)
        flows.append(
            SemanticGraphFlowInput(
                key=key,
                title=_require_string(record, "title"),
                file_paths=file_paths,
                relation_keys=relation_keys,
                fallback=_require_bool(record, "fallback"),
            )
        )
    if assigned_paths != known_paths:
        raise ValueError("Semantic graph flows do not cover all files")
    return tuple(flows)


def _parse_output_files(
    value: object,
    input_file_by_path: dict[str, SemanticGraphFileInput],
) -> tuple[SemanticGraphFileOutput, ...]:
    items = _require_list(value, "semantic graph output files")
    files: list[SemanticGraphFileOutput] = []
    seen_paths: set[str] = set()
    for item in items:
        record = _require_dict(item, "semantic graph output file")
        file_path = _require_string(record, "filePath")
        input_file = input_file_by_path.get(file_path)
        if input_file is None or file_path in seen_paths:
            raise ValueError("Unknown or duplicate semantic graph output file")
        role_type = _require_one_of(record, "roleType", PR_REVIEW_FILE_ROLES)
        if not input_file.role_override_allowed and role_type != input_file.role_type:
            raise ValueError("AI changed a locked semantic graph file role")
        seen_paths.add(file_path)
        files.append(
            SemanticGraphFileOutput(
                file_path=file_path,
                role_type=role_type,
                role_reason=_require_string(record, "roleReason"),
            )
        )
    if seen_paths != set(input_file_by_path):
        raise ValueError("Semantic graph output omitted an input file")
    return tuple(files)


def _parse_output_relations(
    value: object,
    known_paths: set[str],
    candidate_keys: set[str],
) -> tuple[SemanticGraphRelationOutput, ...]:
    items = _require_list(value, "semantic graph output relations")
    relations: list[SemanticGraphRelationOutput] = []
    seen_identities: set[tuple[str, str, str]] = set()
    for item in items:
        record = _require_dict(item, "semantic graph output relation")
        from_path = _require_string(record, "fromFilePath")
        to_path = _require_string(record, "toFilePath")
        relation_type = _require_one_of(record, "relationType", PR_REVIEW_RELATION_TYPES)
        identity = (from_path, to_path, relation_type)
        if (
            from_path not in known_paths
            or to_path not in known_paths
            or from_path == to_path
            or identity in seen_identities
        ):
            raise ValueError("Invalid semantic graph output relation")
        candidate_key = _read_optional_string(record, "candidateKey")
        if candidate_key is not None and candidate_key not in candidate_keys:
            raise ValueError("Unknown semantic graph relation candidate key")
        seen_identities.add(identity)
        relations.append(
            SemanticGraphRelationOutput(
                candidate_key=candidate_key,
                from_file_path=from_path,
                to_file_path=to_path,
                relation_type=relation_type,
                reason=_require_string(record, "reason"),
            )
        )
    return tuple(relations)


def _parse_output_flows(
    value: object,
    input_flows: tuple[SemanticGraphFlowInput, ...],
) -> tuple[SemanticGraphFlowOutput, ...]:
    items = _require_list(value, "semantic graph output flows")
    input_by_key = {flow.key: flow for flow in input_flows}
    flows: list[SemanticGraphFlowOutput] = []
    seen_keys: set[str] = set()
    for item in items:
        record = _require_dict(item, "semantic graph output flow")
        candidate_key = _require_string(record, "candidateKey")
        input_flow = input_by_key.get(candidate_key)
        review_order = _require_string_tuple(record, "reviewOrder")
        if (
            input_flow is None
            or candidate_key in seen_keys
            or len(review_order) != len(set(review_order))
            or set(review_order) != set(input_flow.file_paths)
        ):
            raise ValueError("Invalid semantic graph output flow")
        seen_keys.add(candidate_key)
        flows.append(
            SemanticGraphFlowOutput(
                candidate_key=candidate_key,
                title=_require_string(record, "title"),
                description=_require_string(record, "description"),
                review_order=review_order,
            )
        )
    if seen_keys != set(input_by_key):
        raise ValueError("Semantic graph output omitted an input flow")
    return tuple(flows)


def _closed_object(required: list[str], properties: dict[str, object]) -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def _require_dict(value: object, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"Invalid {field}")
    return value


def _require_list(value: object, field: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"Invalid {field}")
    return value


def _require_string(value: dict[str, object], key: str) -> str:
    raw = value.get(key)
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"Invalid {key}")
    return raw.strip()


def _read_optional_string(value: dict[str, object], key: str) -> str | None:
    raw = value.get(key)
    if raw is None:
        return None
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"Invalid {key}")
    return raw.strip()


def _require_string_tuple(
    value: dict[str, object], key: str, *, allow_empty: bool = False
) -> tuple[str, ...]:
    raw = value.get(key)
    if not isinstance(raw, list) or (not allow_empty and not raw):
        raise ValueError(f"Invalid {key}")
    result: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"Invalid {key}")
        result.append(item.strip())
    return tuple(result)


def _require_one_of(value: dict[str, object], key: str, allowed: set[str]) -> str:
    result = _require_string(value, key)
    if result not in allowed:
        raise ValueError(f"Invalid {key}")
    return result


def _require_confidence(value: dict[str, object], key: str) -> int:
    raw = value.get(key)
    if isinstance(raw, bool) or not isinstance(raw, int) or not 0 <= raw <= 100:
        raise ValueError(f"Invalid {key}")
    return raw


def _require_bool(value: dict[str, object], key: str) -> bool:
    raw = value.get(key)
    if not isinstance(raw, bool):
        raise ValueError(f"Invalid {key}")
    return raw
