import { createHash } from "node:crypto";
import { CompleteShapeWriteValues } from "../contracts/canvas.types";

export function computeShapeContentHash(values: CompleteShapeWriteValues): string {
  return createHash("sha256")
    .update(stableStringify(values))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : canonicalizeJsonValue(item)
    );
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const item = value[key];

        if (item === undefined) {
          return result;
        }

        result[key] = canonicalizeJsonValue(item);
        return result;
      }, {});
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
