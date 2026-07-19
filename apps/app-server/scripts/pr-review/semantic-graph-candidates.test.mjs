import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildDeterministicSemanticGraphCandidates,
  buildDeterministicSemanticGraphCandidatesV2
} = require(
  "../../dist/modules/pr-review/pr-review-semantic-graph.js"
);

function changedFile(filePath, patch, overrides = {}) {
  return {
    filePath,
    previousFilePath: null,
    fileStatus: "modified",
    isBinary: false,
    patch,
    ...overrides
  };
}

const files = [
  changedFile(
    "apps/app-server/src/users/user.controller.ts",
    `@@ -1,2 +1,4 @@
+import { UserService } from "./user.service";
+import { CreateUserDto } from "./dto/create-user.dto";
 export class UserController {}`
  ),
  changedFile(
    "apps/app-server/src/users/user.service.ts",
    `@@ -1,2 +1,3 @@
 export class UserService {
+  private readonly tableName = "user_profiles";
 }`
  ),
  changedFile(
    "apps/app-server/src/users/dto/create-user.dto.ts",
    `@@ -0,0 +1,3 @@
+export interface CreateUserDto {
+  name: string;
+}`,
    { fileStatus: "added" }
  ),
  changedFile(
    "apps/app-server/src/users/user.service.spec.ts",
    `@@ -0,0 +1,2 @@
+import { UserService } from "./user.service";
+describe("UserService", () => {});`,
    { fileStatus: "added" }
  ),
  changedFile(
    "apps/frontend/src/features/users/components/UserForm.tsx",
    `@@ -1,2 +1,3 @@
+import { createUser } from "../api/user-api";
 export function UserForm() {}`
  ),
  changedFile(
    "apps/frontend/src/features/users/api/user-api.ts",
    `@@ -0,0 +1,2 @@
+export async function createUser() {}
+export type UserResponse = {};`,
    { fileStatus: "added" }
  ),
  changedFile(
    "db/migrations/041_create_user_profiles.sql",
    `@@ -0,0 +1,2 @@
+CREATE TABLE user_profiles (id UUID PRIMARY KEY);
+CREATE INDEX idx_user_profiles_id ON user_profiles(id);`,
    { fileStatus: "added" }
  ),
  changedFile("docs/users.md", null),
  changedFile(
    "apps/app-server/src/users/legacy-consumer.ts",
    `@@ -1,2 +1 @@
-import { LegacyUser } from "./legacy-user";
 export const active = true;`
  ),
  changedFile(
    "apps/app-server/src/users/legacy-user.ts",
    `@@ -1 +1 @@
-export const LegacyUser = true;
+export const LegacyUser = false;`
  )
];

const result = buildDeterministicSemanticGraphCandidates(files);

assert.deepEqual(result, buildDeterministicSemanticGraphCandidates(files));

const roleByPath = new Map(
  result.files.map((file) => [file.filePath, file.roleType])
);
assert.equal(
  roleByPath.get("apps/app-server/src/users/user.controller.ts"),
  "entry"
);
assert.equal(
  roleByPath.get("apps/app-server/src/users/user.service.ts"),
  "core_logic"
);
assert.equal(
  roleByPath.get("apps/app-server/src/users/dto/create-user.dto.ts"),
  "api_contract"
);
assert.equal(
  roleByPath.get("apps/app-server/src/users/user.service.spec.ts"),
  "verification"
);
assert.equal(
  roleByPath.get("apps/frontend/src/features/users/components/UserForm.tsx"),
  "ui_state"
);
assert.equal(roleByPath.get("db/migrations/041_create_user_profiles.sql"), "support");
assert.equal(roleByPath.get("docs/users.md"), "support");

function relation(fromFilePath, toFilePath, relationType) {
  return result.relations.find(
    (candidate) =>
      candidate.fromFilePath === fromFilePath &&
      candidate.toFilePath === toFilePath &&
      candidate.relationType === relationType
  );
}

assert.equal(
  relation(
    "apps/app-server/src/users/user.controller.ts",
    "apps/app-server/src/users/user.service.ts",
    "depends_on"
  )?.confidence,
  90
);
assert.equal(
  relation(
    "apps/app-server/src/users/user.controller.ts",
    "apps/app-server/src/users/dto/create-user.dto.ts",
    "uses_api"
  )?.confidence,
  92
);
assert.equal(
  relation(
    "apps/app-server/src/users/user.service.spec.ts",
    "apps/app-server/src/users/user.service.ts",
    "tests"
  )?.confidence,
  98
);
assert.equal(
  relation(
    "apps/frontend/src/features/users/components/UserForm.tsx",
    "apps/frontend/src/features/users/api/user-api.ts",
    "uses_api"
  )?.confidence,
  92
);
assert.equal(
  relation(
    "db/migrations/041_create_user_profiles.sql",
    "apps/app-server/src/users/user.service.ts",
    "supports"
  )?.confidence,
  65
);
assert.equal(
  relation(
    "apps/app-server/src/users/legacy-consumer.ts",
    "apps/app-server/src/users/legacy-user.ts",
    "depends_on"
  ),
  undefined
);
assert.equal(
  result.relations.some(
    (candidate) => candidate.fromFilePath === candidate.toFilePath
  ),
  false
);

const knownPaths = new Set(files.map((file) => file.filePath));
assert.equal(
  result.relations.every(
    (candidate) =>
      knownPaths.has(candidate.fromFilePath) && knownPaths.has(candidate.toFilePath)
  ),
  true
);

const flowFilePaths = result.flows.flatMap((flow) => flow.filePaths);
assert.equal(flowFilePaths.length, new Set(flowFilePaths).size);
assert.deepEqual(new Set(flowFilePaths), knownPaths);
assert.equal(
  result.flows
    .find((flow) => flow.fallback)
    ?.filePaths.includes("docs/users.md"),
  true
);
assert.equal(
  result.flows.every((flow) =>
    flow.relationKeys.every((key) => result.relations.some((relation) => relation.key === key))
  ),
  true
);

{
  const aliasResult = buildDeterministicSemanticGraphCandidates([
    changedFile(
      "apps/frontend/src/features/users/components/AliasForm.tsx",
      `@@ -0,0 +1 @@
+import { createUser } from "@/features/users/api/user-api";`
    ),
    changedFile(
      "apps/frontend/src/features/users/api/user-api.ts",
      `@@ -0,0 +1 @@
+export async function createUser() {}`
    )
  ]);

  assert.equal(aliasResult.relations.length, 0);
  assert.equal(aliasResult.flows.length, 1);
  assert.equal(aliasResult.flows[0].fallback, true);
  assert.equal(aliasResult.flows[0].filePaths.length, 2);
}

{
  const packageResult = buildDeterministicSemanticGraphCandidates([
    changedFile(
      "apps/app-server/package.json",
      `@@ -1,3 +1,4 @@
+  "new-package": "1.0.0"`
    ),
    changedFile(
      "apps/app-server/package-lock.json",
      `@@ -1,3 +1,4 @@
+  "new-package": "1.0.0"`
    )
  ]);

  assert.deepEqual(
    packageResult.relations.map((candidate) => ({
      fromFilePath: candidate.fromFilePath,
      toFilePath: candidate.toFilePath,
      relationType: candidate.relationType,
      confidence: candidate.confidence,
      evidence: candidate.evidence
    })),
    [
      {
        fromFilePath: "apps/app-server/package-lock.json",
        toFilePath: "apps/app-server/package.json",
        relationType: "supports",
        confidence: 98,
        evidence: "package_lock_manifest"
      }
    ]
  );
  assert.equal(packageResult.flows.length, 1);
  assert.equal(packageResult.flows[0].fallback, false);
}

{
  const explicitReferenceResult = buildDeterministicSemanticGraphCandidates([
    changedFile(
      "docs/user-service.md",
      `@@ -0,0 +1 @@
+Review apps/app-server/src/users/user.service.ts before deployment.`
    ),
    changedFile(
      "apps/app-server/src/users/user.service.ts",
      `@@ -1 +1,2 @@
+export const enabled = true;`
    )
  ]);

  assert.equal(explicitReferenceResult.relations[0]?.evidence, "explicit_file_reference");
  assert.equal(explicitReferenceResult.relations[0]?.confidence, 75);
  assert.equal(explicitReferenceResult.flows[0]?.fallback, false);
}

{
  const reverseReferenceResult = buildDeterministicSemanticGraphCandidates([
    changedFile("docs/deployment.md", null),
    changedFile(
      "apps/app-server/src/deployment.ts",
      `@@ -1 +1,2 @@
+// Keep docs/deployment.md synchronized with this policy.`
    )
  ]);

  assert.equal(reverseReferenceResult.relations[0]?.evidence, "explicit_file_reference");
}

assert.throws(
  () =>
    buildDeterministicSemanticGraphCandidates([
      changedFile("duplicate.ts", null),
      changedFile("duplicate.ts", null)
    ]),
  /unique and non-empty/
);

{
  const v2 = buildDeterministicSemanticGraphCandidatesV2([
    changedFile(
      "apps/app-server/src/a.ts",
      `@@ -1 +1 @@
+export const a = true;`
    ),
    changedFile(
      "apps/app-server/src/a.spec.ts",
      `@@ -0,0 +1 @@
+describe("a", () => {});`,
      { fileStatus: "added" }
    ),
    changedFile(
      "apps/ai-worker/app/b.py",
      `@@ -1 +1 @@
+b = True`
    ),
    changedFile(
      "apps/ai-worker/tests/test_b.py",
      `@@ -0,0 +1 @@
+def test_b(): pass`,
      { fileStatus: "added" }
    ),
    changedFile(
      "apps/frontend/src/x.ts",
      `@@ -1 +1 @@
+import { y } from "./y";`
    ),
    changedFile(
      "apps/frontend/src/y.ts",
      `@@ -1 +1 @@
+export const y = true;`
    )
  ]);

  assert.equal(
    v2.relations.find((relation) => relation.evidence.startsWith("relative_import:"))
      .groupingBinding,
    "hint"
  );
  assert.equal(
    v2.relations.find((relation) => relation.evidence === "matching_test_filename")
      .groupingBinding,
    "locked"
  );
  assert.equal(
    v2.flows.some(
      (flow) =>
        flow.filePaths.includes("apps/app-server/src/a.ts") &&
        flow.filePaths.includes("apps/ai-worker/app/b.py")
    ),
    false
  );
}

{
  const crossLanguageResult = buildDeterministicSemanticGraphCandidates([
    changedFile(
      "services/user_service.py",
      `@@ -1 +1,2 @@
 class UserService:
+    pass`
    ),
    changedFile(
      "tests/test_user_service.py",
      `@@ -0,0 +1 @@
+def test_create_user(): pass`,
      { fileStatus: "added" }
    ),
    changedFile(
      "src/main/java/UserAccount.java",
      `@@ -1 +1 @@
-class UserAccount {}
+class UserAccount {}`
    ),
    changedFile(
      "src/test/java/UserAccountTest.java",
      `@@ -0,0 +1 @@
+class UserAccountTest {}`,
      { fileStatus: "added" }
    )
  ]);

  assert.equal(
    crossLanguageResult.relations.some(
      (candidate) =>
        candidate.fromFilePath === "tests/test_user_service.py" &&
        candidate.toFilePath === "services/user_service.py" &&
        candidate.relationType === "tests"
    ),
    true
  );
  assert.equal(
    crossLanguageResult.relations.some(
      (candidate) =>
        candidate.fromFilePath === "src/test/java/UserAccountTest.java" &&
        candidate.toFilePath === "src/main/java/UserAccount.java" &&
        candidate.relationType === "tests"
    ),
    true
  );
}
