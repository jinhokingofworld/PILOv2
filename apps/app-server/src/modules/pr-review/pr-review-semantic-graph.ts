import { posix as path } from "node:path";
import type {
  PrReviewFileRoleType,
  PrReviewFileStatus,
  PrReviewRelationType
} from "./types";
import {
  buildSemanticFlowCandidates,
  buildSemanticFlowCandidatesV2
} from "./pr-review-semantic-flow";
import { buildSupportRelationCandidates } from "./pr-review-semantic-support";

const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".vue"
]);
const IMPORT_TARGET_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json"
];
export interface PrReviewSemanticGraphFileInput {
  filePath: string;
  previousFilePath: string | null;
  fileStatus: PrReviewFileStatus;
  isBinary: boolean;
  patch: string | null;
}

export interface PrReviewFileRoleCandidate {
  filePath: string;
  roleType: PrReviewFileRoleType;
  confidence: number;
  evidence: string;
}

export interface PrReviewRelationCandidate {
  key: string;
  fromFilePath: string;
  toFilePath: string;
  relationType: PrReviewRelationType;
  source: "rule";
  confidence: number;
  evidence: string;
}

export type PrReviewRelationCandidateInput = Omit<
  PrReviewRelationCandidate,
  "key" | "source"
>;

export interface PrReviewFlowCandidate {
  key: string;
  title: string;
  filePaths: string[];
  relationKeys: string[];
  fallback: boolean;
}

export interface PrReviewSemanticGraphCandidates {
  files: PrReviewFileRoleCandidate[];
  relations: PrReviewRelationCandidate[];
  flows: PrReviewFlowCandidate[];
}

export type PrReviewGroupingBinding = "locked" | "hint";

export interface PrReviewRelationCandidateV2 extends PrReviewRelationCandidate {
  groupingBinding: PrReviewGroupingBinding;
}

export interface PrReviewSemanticGraphCandidatesV2 {
  files: PrReviewFileRoleCandidate[];
  relations: PrReviewRelationCandidateV2[];
  flows: PrReviewFlowCandidate[];
}

export function buildDeterministicSemanticGraphCandidates(
  inputFiles: readonly PrReviewSemanticGraphFileInput[]
): PrReviewSemanticGraphCandidates {
  const files = normalizeInputFiles(inputFiles);
  const roles = files.map(inferFileRoleCandidate);
  const roleByPath = new Map(roles.map((role) => [role.filePath, role]));
  const relationByKey = new Map<string, PrReviewRelationCandidate>();

  addImportRelations(files, roleByPath, relationByKey);
  addTestNameRelations(files, roleByPath, relationByKey);
  for (const relation of buildSupportRelationCandidates(files, roleByPath)) {
    addRelation(relationByKey, relation);
  }

  const relations = [...relationByKey.values()].sort(compareRelations);
  const flows = buildSemanticFlowCandidates(roles, relations);

  return {
    files: roles,
    relations,
    flows
  };
}

export function buildDeterministicSemanticGraphCandidatesV2(
  inputFiles: readonly PrReviewSemanticGraphFileInput[]
): PrReviewSemanticGraphCandidatesV2 {
  const candidates = buildDeterministicSemanticGraphCandidates(inputFiles);
  const relations: PrReviewRelationCandidateV2[] = candidates.relations.map((relation) => ({
    ...relation,
    groupingBinding: isLockedEvidence(relation.evidence) ? "locked" : "hint"
  }));

  return {
    files: candidates.files,
    relations,
    flows: buildSemanticFlowCandidatesV2(candidates.files, relations)
  };
}

function isLockedEvidence(evidence: string): boolean {
  return (
    evidence === "matching_test_filename" || evidence === "package_lock_manifest"
  );
}

function normalizeInputFiles(
  inputFiles: readonly PrReviewSemanticGraphFileInput[]
): PrReviewSemanticGraphFileInput[] {
  const seenPaths = new Set<string>();

  return inputFiles.map((file) => {
    const filePath = normalizeRepositoryPath(file.filePath);
    if (
      !filePath ||
      filePath === ".." ||
      filePath.startsWith("../") ||
      path.isAbsolute(filePath) ||
      seenPaths.has(filePath)
    ) {
      throw new Error("Semantic graph input file paths must be unique and non-empty");
    }
    seenPaths.add(filePath);

    return {
      ...file,
      filePath,
      previousFilePath: file.previousFilePath
        ? normalizeRepositoryPath(file.previousFilePath)
        : null
    };
  });
}

function inferFileRoleCandidate(
  file: PrReviewSemanticGraphFileInput
): PrReviewFileRoleCandidate {
  const filePath = file.filePath.toLowerCase();
  const extension = path.extname(filePath);

  if (file.isBinary) {
    return roleCandidate(file.filePath, "unknown", 100, "binary_file");
  }

  if (isTestPath(filePath)) {
    return roleCandidate(file.filePath, "verification", 95, "test_path");
  }

  if (isSupportPath(filePath)) {
    return roleCandidate(file.filePath, "support", 90, "support_path");
  }

  if (isEntryPath(filePath)) {
    return roleCandidate(file.filePath, "entry", 90, "entry_path");
  }

  if (isApiContractPath(filePath)) {
    return roleCandidate(file.filePath, "api_contract", 85, "api_contract_path");
  }

  if (isUiStatePath(filePath)) {
    return roleCandidate(file.filePath, "ui_state", 85, "ui_state_path");
  }

  if (CODE_EXTENSIONS.has(extension)) {
    return roleCandidate(file.filePath, "core_logic", 65, "code_file_fallback");
  }

  return roleCandidate(file.filePath, "unknown", 60, "unrecognized_file_type");
}

function roleCandidate(
  filePath: string,
  roleType: PrReviewFileRoleType,
  confidence: number,
  evidence: string
): PrReviewFileRoleCandidate {
  return { filePath, roleType, confidence, evidence };
}

function isTestPath(filePath: string): boolean {
  return (
    /(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(filePath) ||
    /\.(spec|test)\.[^/]+$/.test(filePath) ||
    /(^|\/)(test_[^/]+|[^/]+_test)\.[^/]+$/.test(filePath) ||
    /(^|\/)[^/]+tests?\.(java|kt|cs)$/.test(filePath)
  );
}

function isSupportPath(filePath: string): boolean {
  const fileName = path.basename(filePath);
  return (
    /(^|\/)(docs?|migrations?|scripts?)(\/|$)/.test(filePath) ||
    /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(
      filePath
    ) ||
    /(^|\/)(dockerfile|makefile)$/.test(filePath) ||
    /\.(md|mdx|ya?ml|toml)$/.test(filePath) ||
    /(^|\.)(config|conf)\.[^/]+$/.test(fileName) ||
    fileName === ".env.example"
  );
}

function isEntryPath(filePath: string): boolean {
  return (
    /(^|\/)(controllers?|resolvers?|routes?)(\/|$)/.test(filePath) ||
    /\.(controller|resolver|route)\.[^/]+$/.test(filePath) ||
    /(^|\/)(main|page|route)\.[^/]+$/.test(filePath)
  );
}

function isApiContractPath(filePath: string): boolean {
  return (
    /(^|\/)(api|dto|schemas?|types?)(\/|$)/.test(filePath) ||
    /\.(api|dto|schema|types?)\.[^/]+$/.test(filePath)
  );
}

function isUiStatePath(filePath: string): boolean {
  return (
    /(^|\/)(components?|hooks?|stores?|slices?|styles?)(\/|$)/.test(filePath) ||
    /\.(css|scss|vue)$/.test(filePath)
  );
}

function addImportRelations(
  files: readonly PrReviewSemanticGraphFileInput[],
  roleByPath: ReadonlyMap<string, PrReviewFileRoleCandidate>,
  relationByKey: Map<string, PrReviewRelationCandidate>
): void {
  const filePaths = new Set(files.map((file) => file.filePath));

  for (const file of files) {
    const importerRole = roleByPath.get(file.filePath)?.roleType ?? "unknown";
    for (const specifier of extractPatchImportSpecifiers(file.patch)) {
      const targetPath = resolveChangedImportPath(file.filePath, specifier, filePaths);
      if (!targetPath || targetPath === file.filePath) {
        continue;
      }

      const targetRole = roleByPath.get(targetPath)?.roleType ?? "unknown";
      const isTestRelation = importerRole === "verification";
      const relationType = isTestRelation
        ? "tests"
        : isApiUsage(importerRole, targetRole, targetPath)
          ? "uses_api"
          : "depends_on";

      addRelation(relationByKey, {
        fromFilePath: file.filePath,
        toFilePath: targetPath,
        relationType,
        confidence: isTestRelation ? 98 : relationType === "uses_api" ? 92 : 90,
        evidence: `relative_import:${specifier}`
      });
    }
  }
}

function isApiUsage(
  importerRole: PrReviewFileRoleType,
  targetRole: PrReviewFileRoleType,
  targetPath: string
): boolean {
  return (
    (importerRole === "ui_state" || importerRole === "entry") &&
    (targetRole === "api_contract" || /(^|\/).*api[^/]*\.[^/]+$/.test(targetPath))
  );
}

function extractPatchImportSpecifiers(patchValue: string | null): string[] {
  const specifiers = new Set<string>();

  for (const line of retainedPatchLines(patchValue)) {
    const patterns = [
      /\bfrom\s*["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
      /^\s*import\s*["']([^"']+)["']/g
    ];

    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        const specifier = match[1]?.trim();
        if (specifier?.startsWith(".")) {
          specifiers.add(specifier);
        }
      }
    }
  }

  return [...specifiers].sort();
}

function retainedPatchLines(patchValue: string | null): string[] {
  if (!patchValue) {
    return [];
  }

  const lines: string[] = [];
  for (const line of patchValue.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      lines.push(line.slice(1));
    }
  }
  return lines;
}

function resolveChangedImportPath(
  importerPath: string,
  specifier: string,
  filePaths: ReadonlySet<string>
): string | null {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const basePath = normalizeRepositoryPath(
    path.join(path.dirname(importerPath), cleanSpecifier)
  );
  if (!basePath || basePath.startsWith("../")) {
    return null;
  }

  const candidates = [basePath];
  if (!IMPORT_TARGET_EXTENSIONS.includes(path.extname(basePath))) {
    for (const extension of IMPORT_TARGET_EXTENSIONS) {
      candidates.push(`${basePath}${extension}`);
      candidates.push(`${basePath}/index${extension}`);
    }
  }

  return candidates.find((candidate) => filePaths.has(candidate)) ?? null;
}

function addTestNameRelations(
  files: readonly PrReviewSemanticGraphFileInput[],
  roleByPath: ReadonlyMap<string, PrReviewFileRoleCandidate>,
  relationByKey: Map<string, PrReviewRelationCandidate>
): void {
  const targetFiles = files.filter(
    (file) => roleByPath.get(file.filePath)?.roleType !== "verification"
  );

  for (const testFile of files) {
    if (roleByPath.get(testFile.filePath)?.roleType !== "verification") {
      continue;
    }

    const testStem = normalizedTestStem(testFile.filePath);
    const matches = targetFiles.filter(
      (target) => normalizedFileStem(target.filePath) === testStem
    );
    const target = chooseClosestPath(testFile.filePath, matches);
    if (!target) {
      continue;
    }

    addRelation(relationByKey, {
      fromFilePath: testFile.filePath,
      toFilePath: target.filePath,
      relationType: "tests",
      confidence: 85,
      evidence: "matching_test_filename"
    });
  }
}

function normalizedTestStem(filePath: string): string {
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath, extension);
  return normalizeStem(
    baseName
      .replace(/^test[._-]?/i, "")
      .replace(/[._-]?(spec|tests?)$/i, "")
  );
}

function normalizedFileStem(filePath: string): string {
  const extension = path.extname(filePath);
  return normalizeStem(path.basename(filePath, extension));
}

function normalizeStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function chooseClosestPath(
  sourcePath: string,
  matches: readonly PrReviewSemanticGraphFileInput[]
): PrReviewSemanticGraphFileInput | null {
  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0];
  }

  const ranked = matches
    .map((match) => ({
      match,
      score: commonDirectoryPrefixLength(sourcePath, match.filePath)
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.match.filePath.localeCompare(right.match.filePath)
    );

  return ranked[0].score > ranked[1].score ? ranked[0].match : null;
}

function commonDirectoryPrefixLength(leftPath: string, rightPath: string): number {
  const left = path.dirname(leftPath).split("/");
  const right = path.dirname(rightPath).split("/");
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) {
    count += 1;
  }
  return count;
}

function addRelation(
  relationByKey: Map<string, PrReviewRelationCandidate>,
  input: PrReviewRelationCandidateInput
): void {
  if (input.fromFilePath === input.toFilePath) {
    return;
  }

  const key = relationKey(input.fromFilePath, input.toFilePath, input.relationType);
  const existing = relationByKey.get(key);
  if (existing && existing.confidence >= input.confidence) {
    return;
  }

  relationByKey.set(key, { ...input, key, source: "rule" });
}

function relationKey(
  fromFilePath: string,
  toFilePath: string,
  relationType: PrReviewRelationType
): string {
  return `${relationType}:${fromFilePath}->${toFilePath}`;
}

function compareRelations(
  left: PrReviewRelationCandidate,
  right: PrReviewRelationCandidate
): number {
  return (
    left.fromFilePath.localeCompare(right.fromFilePath) ||
    left.toFilePath.localeCompare(right.toFilePath) ||
    left.relationType.localeCompare(right.relationType) ||
    right.confidence - left.confidence
  );
}

function normalizeRepositoryPath(value: string): string {
  const normalized = path.normalize(value.trim().replace(/\\/g, "/"));
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}
