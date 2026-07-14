import type {
  PrReviewFileStatus,
  PrReviewGithubConflictContentPayload
} from "./types";

type PathConflictState =
  | "clean"
  | "content_candidate"
  | "add_add"
  | "modify_delete";

export type PrReviewConflictFileClassification =
  | { kind: "none" }
  | {
      kind: "content_candidate";
      input: PrReviewGithubConflictContentPayload;
    }
  | { kind: "unsupported"; reason: string };

function classifyPathConflict(
  input: PrReviewGithubConflictContentPayload
): PathConflictState {
  const ancestor = input.mergeBaseContent;
  const base = input.baseContent;
  const head = input.headContent;

  if (ancestor === null) {
    return base !== null && head !== null && base !== head
      ? "add_add"
      : "clean";
  }

  if (base === null && head === null) {
    return "clean";
  }

  if (base === null) {
    return head === ancestor ? "clean" : "modify_delete";
  }

  if (head === null) {
    return base === ancestor ? "clean" : "modify_delete";
  }

  if (base === ancestor || head === ancestor || base === head) {
    return "clean";
  }

  return "content_candidate";
}

export function classifyPrReviewConflictFile(input: {
  fileStatus: PrReviewFileStatus;
  currentPathInput: PrReviewGithubConflictContentPayload | null;
  previousPathInput?: PrReviewGithubConflictContentPayload | null;
}): PrReviewConflictFileClassification {
  if (!input.currentPathInput) {
    return {
      kind: "unsupported",
      reason: "content conflict input is not available"
    };
  }

  const currentState = classifyPathConflict(input.currentPathInput);

  switch (input.fileStatus) {
    case "modified":
      if (currentState === "clean") return { kind: "none" };
      if (currentState === "content_candidate") {
        return {
          kind: "content_candidate",
          input: input.currentPathInput
        };
      }
      return {
        kind: "unsupported",
        reason:
          currentState === "add_add"
            ? "add/add conflict is not supported in the initial read-only slice"
            : "modify/delete conflict is not supported in the initial read-only slice"
      };
    case "added":
      return currentState === "clean"
        ? { kind: "none" }
        : {
            kind: "unsupported",
            reason: "add/add conflict is not supported in the initial read-only slice"
          };
    case "deleted":
      return currentState === "clean"
        ? { kind: "none" }
        : {
            kind: "unsupported",
            reason:
              "modify/delete conflict is not supported in the initial read-only slice"
          };
    case "renamed": {
      if (!input.previousPathInput) {
        return {
          kind: "unsupported",
          reason: "previous path conflict input is not available"
        };
      }

      const previousState = classifyPathConflict(input.previousPathInput);
      return currentState === "clean" && previousState === "clean"
        ? { kind: "none" }
        : {
            kind: "unsupported",
            reason:
              "rename/modify conflict is not supported in the initial read-only slice"
          };
    }
  }
}
