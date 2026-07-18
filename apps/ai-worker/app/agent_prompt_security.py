from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

PROMPT_SECURITY_GATE_VERSION = "agent-prompt-security:v1"

_OVERRIDE_PATTERNS = (
    re.compile(
        r"(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?"
        r"(?:(?:previous|prior)(?:\s+(?:system|developer))?|system|developer)\s+"
        r"(?:instructions?|messages?|rules?|prompts?)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:이전|기존|앞선|위의|시스템|system|developer)\s*"
        r"(?:지시|명령|규칙|프롬프트|메시지)(?:를|을|은|는)?\s*"
        r"(?:무시|잊|폐기|덮어쓰|우회|따르지\s*마)",
        re.IGNORECASE,
    ),
)
_SENSITIVE_DISCLOSURE_PATTERNS = (
    re.compile(
        r"(?:reveal|show|print|return|expose|leak)\b.{0,48}"
        r"(?:system\s*prompt|developer\s*message|api[ _-]*key|access[ _-]*token|"
        r"client[ _-]*secret|private[ _-]*key|authorization\s*header|environment\s*variables?)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:system\s*prompt|developer\s*message|api[ _-]*key|access[ _-]*token|"
        r"client[ _-]*secret|private[ _-]*key|authorization\s*header|environment\s*variables?)"
        r".{0,48}(?:reveal|show|print|return|출력|보여|알려|공개)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:시스템\s*프롬프트|개발자\s*메시지|API\s*키|액세스\s*토큰|비밀\s*키|"
        r"인증\s*헤더|환경\s*변수)(?:를|을|은|는)?.{0,32}"
        r"(?:출력|보여|알려|공개)",
        re.IGNORECASE,
    ),
)
_TOOL_CONTROL_PATTERNS = (
    re.compile(
        r"(?:bypass|escape|ignore|override)\b.{0,48}"
        r"(?:tool\s*(?:registry|list)|shortlist|AGENT_TOOL_RETRIEVAL_MODE)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:tool\s*(?:registry|list)|shortlist|AGENT_TOOL_RETRIEVAL_MODE)"
        r".{0,48}(?:bypass|escape|ignore|override|change|set)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:도구\s*(?:목록|registry)|shortlist|AGENT_TOOL_RETRIEVAL_MODE)"
        r".{0,40}(?:무시|우회|탈출|바꾸|변경|설정|강제)",
        re.IGNORECASE,
    ),
)
_AUTHORIZATION_BYPASS_PATTERNS = (
    re.compile(
        r"(?:skip|bypass|disable|ignore)\b.{0,40}"
        r"(?:confirmation|permission|authorization|access\s*control|workspace\s*check)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:confirmation|permission|authorization|access\s*control|workspace\s*check)"
        r".{0,40}(?:skip|bypass|disable|ignore|무시|우회|생략|건너뛰|비활성화)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:확인|승인|권한|접근\s*제어|워크스페이스\s*검사)(?:을|를|은|는)?"
        r".{0,32}(?:없이|무시|우회|생략|건너뛰|비활성화|받지\s*말)",
        re.IGNORECASE,
    ),
)

_SIGNAL_PATTERNS = {
    "instruction_override": _OVERRIDE_PATTERNS,
    "sensitive_disclosure": _SENSITIVE_DISCLOSURE_PATTERNS,
    "tool_control_override": _TOOL_CONTROL_PATTERNS,
    "authorization_bypass": _AUTHORIZATION_BYPASS_PATTERNS,
}


@dataclass(frozen=True)
class PromptSecurityAssessment:
    suspected: bool
    source_kinds: tuple[str, ...]
    signal_types: tuple[str, ...]

    def observation(self) -> dict[str, object]:
        return {
            "version": PROMPT_SECURITY_GATE_VERSION,
            "status": "blocked" if self.suspected else "clear",
            "reason": "prompt_injection_suspected" if self.suspected else None,
            "sourceKinds": list(self.source_kinds),
            "signalTypes": list(self.signal_types),
            "signalCount": len(self.signal_types),
        }


@dataclass(frozen=True)
class PromptSecuritySource:
    source_kind: str
    text: str


def assess_agent_prompt_security(
    prompt: str,
    context_sources: tuple[PromptSecuritySource, ...] = (),
    *,
    prompt_source_kind: str = "current_user",
) -> PromptSecurityAssessment:
    sources = (PromptSecuritySource(prompt_source_kind, prompt), *context_sources)

    source_kinds: set[str] = set()
    signal_types: set[str] = set()
    for source in sources:
        normalized_text = _normalize_security_text(source.text)
        matched = {
            signal_type
            for signal_type, patterns in _SIGNAL_PATTERNS.items()
            if any(_has_actionable_match(pattern, normalized_text) for pattern in patterns)
        }
        if matched:
            source_kinds.add(source.source_kind)
            signal_types.update(matched)

    return PromptSecurityAssessment(
        suspected=bool(signal_types),
        source_kinds=tuple(sorted(source_kinds)),
        signal_types=tuple(sorted(signal_types)),
    )


def _normalize_security_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = re.sub(r"[\u200b-\u200d\ufeff]", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _has_actionable_match(pattern: re.Pattern[str], text: str) -> bool:
    return any(not _is_negated_or_reported(text, match) for match in pattern.finditer(text))


def _is_negated_or_reported(text: str, match: re.Match[str]) -> bool:
    before = text[max(0, match.start() - 32) : match.start()]
    after = text[match.end() : match.end() + 96]
    if re.search(r"(?:do|does|did|should|must|can|could|would)\s+not\s*$|never\s*$", before, re.I):
        return True
    if re.match(
        r"\s*(?:하지\s*(?:않|말|마)|하면\s*안|해서는\s*안|해서\s*안|금지|방지)",
        after,
        re.I,
    ):
        if re.match(
            r"\s*하지\s*(?:않고|말고).{0,32}"
            r"(?:실제로|진짜로|대신|그냥)?.{0,16}"
            r"(?:무시|잊|폐기|덮어쓰|우회|생략|건너뛰|비활성화|"
            r"출력|보여|알려|공개)",
            after,
            re.I,
        ):
            return False
        return True
    if re.match(r"\s*(?:했|하였|됐|되었)(?:다|다고|던|음|기로)", after):
        return True
    return bool(
        re.match(
            r".{0,24}(?:라는|라고|인용한|회고한).{0,32}"
            r"(?:공격|악성|문장|발언|요청|내용).{0,32}"
            r"(?:차단|거절|검토|논의|기록)",
            after,
            re.I,
        )
    )
