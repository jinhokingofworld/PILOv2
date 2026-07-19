const DEFAULT_MEETING_MINIMUM_SIMILARITY = 0.23;
const DEFAULT_DRIVE_MINIMUM_SIMILARITY = 0.27;

export function meetingRagMinimumSimilarity(): number {
  return similarityEnvironment(
    "MEETING_RAG_MIN_SIMILARITY",
    DEFAULT_MEETING_MINIMUM_SIMILARITY
  );
}

export function driveRagMinimumSimilarity(): number {
  return similarityEnvironment(
    "DRIVE_RAG_MIN_SIMILARITY",
    DEFAULT_DRIVE_MINIMUM_SIMILARITY
  );
}

export function passesRelevanceThreshold(score: number, threshold: number): boolean {
  return Number.isFinite(score) && score >= threshold;
}

function similarityEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return value;
}
