export function serializeGithubJsonb(value: unknown): string {
  const serialized = JSON.stringify(value ?? null);
  return serialized ?? "null";
}
