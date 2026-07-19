from __future__ import annotations


class RetryableEmbeddingError(Exception):
    """A temporary provider failure that may succeed on a bounded retry."""


class TerminalEmbeddingError(Exception):
    """A request or response failure that retrying will not correct."""


def classify_openai_embedding_error(error: Exception) -> Exception:
    status_code = getattr(error, "status_code", None)
    error_name = type(error).__name__
    retryable_names = {
        "APITimeoutError",
        "APIConnectionError",
        "RateLimitError",
        "InternalServerError",
    }
    if (
        isinstance(error, TimeoutError | ConnectionError)
        or error_name in retryable_names
        or status_code in {408, 409, 429}
        or (isinstance(status_code, int) and status_code >= 500)
    ):
        return RetryableEmbeddingError("OpenAI embedding is temporarily unavailable")
    return TerminalEmbeddingError("OpenAI embedding failed")
