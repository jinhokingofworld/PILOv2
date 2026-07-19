const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_TIMEOUT_MS = 10_000;

export class EmbeddingTemporarilyUnavailableError extends Error {
  readonly code = "EMBEDDING_TEMPORARILY_UNAVAILABLE";

  constructor(message = "근거 검색이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.") {
    super(message);
    this.name = "EmbeddingTemporarilyUnavailableError";
  }
}

export class InvalidEmbeddingResponseError extends Error {
  readonly code = "INVALID_EMBEDDING_RESPONSE";

  constructor(message = "근거 검색용 임베딩 응답이 올바르지 않습니다.") {
    super(message);
    this.name = "InvalidEmbeddingResponseError";
  }
}

export async function embedGroundingQuery(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const timeoutMs = positiveIntegerEnvironment(
    "OPENAI_QUERY_EMBEDDING_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS
  );

  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: query,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float"
      })
    });

    if (!response.ok) {
      if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) {
        throw new EmbeddingTemporarilyUnavailableError();
      }
      throw new InvalidEmbeddingResponseError();
    }

    let payload: { data?: Array<{ embedding?: unknown }> };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new InvalidEmbeddingResponseError();
    }
    const vector = payload.data?.[0]?.embedding;
    if (
      !Array.isArray(vector) ||
      vector.length !== EMBEDDING_DIMENSIONS ||
      vector.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new InvalidEmbeddingResponseError();
    }
    return vector as number[];
  } catch (error) {
    if (error instanceof InvalidEmbeddingResponseError) throw error;
    if (error instanceof EmbeddingTemporarilyUnavailableError || isRetryableFailure(error)) {
      throw new EmbeddingTemporarilyUnavailableError();
    }
    throw error;
  }
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function isRetryableFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError" || error instanceof TypeError;
}
