import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const fixtureIndex = process.argv.indexOf("--fixture");
const snapshotIndex = process.argv.indexOf("--registry-snapshot");
const fixturePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : null;
const snapshotPath = snapshotIndex >= 0 ? process.argv[snapshotIndex + 1] : null;
if (!fixturePath || !snapshotPath) {
  throw new Error("--fixture and --registry-snapshot are required");
}

const resolvedFixturePath = resolve(fixturePath);
const fixture = JSON.parse(readFileSync(resolvedFixturePath, "utf8"));
const snapshot = JSON.parse(readFileSync(resolve(snapshotPath), "utf8"));
if (
  fixture.version !== "agent-tool-retrieval-quality-gate:v1" ||
  snapshot.format !== "agent-tool-retrieval-registry-snapshot:v1"
) {
  throw new Error("Unsupported quality fixture or registry snapshot");
}

fixture.registrySnapshot = {
  inventorySha256: snapshot.inventory.sha256,
  catalogSha256: snapshot.inventory.catalogSha256,
  eligibleSnapshotSha256: snapshot.eligibleSnapshotSha256
};
fixture.eligibleToolSchemas = snapshot.eligibleToolSchemas;
fixture.toolCapabilityCatalog = snapshot.toolCapabilityCatalog;
writeFileSync(resolvedFixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
