import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { EvidenceStore } from "../src/store/evidenceStore.js";
import { ToolObservation, VERSION } from "../src/contracts/schemas.js";
const stores: EvidenceStore[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function store(policy: "reject" | "oldest_unprotected" = "oldest_unprotected") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-quota-"));
  dirs.push(dir);
  const value = new EvidenceStore(dir, {
    maxStoreBytes: 6 * 1024 * 1024,
    quotaPolicy: policy,
  });
  stores.push(value);
  return value;
}
function observation(
  id: string,
  content = "routine text ".repeat(19000),
): ToolObservation {
  return {
    schemaVersion: VERSION,
    workspaceId: "test",
    sessionId: "session",
    toolCallId: id,
    toolName: "test",
    inputHash: "hash",
    status: "success",
    responseType: "text",
    captureCompleteness: "complete",
    privacyClass: "normal",
    content,
  };
}
it("evicts oldest unprotected evidence and removes its index and file", () => {
  const db = store();
  const first = db.captureObservation(observation("1"), {
    captureSource: "fixture",
  });
  db.db
    .prepare(
      "update artifacts set created_at = '2000-01-01' where artifact_id = ?",
    )
    .run(first.artifactId);
  db.captureObservation(observation("2"), { captureSource: "fixture" });
  db.captureObservation(observation("3"), { captureSource: "fixture" });
  expect(db.getArtifact(first.artifactId)).toBeNull();
  expect(
    fs.existsSync(path.join(db.artifactDir, `${first.artifactId}.txt`)),
  ).toBe(false);
  expect(
    db.db
      .prepare("select count(*) as n from chunks_fts where artifact_id = ?")
      .get(first.artifactId),
  ).toEqual({ n: 0 });
});
it("protects pinned and criterion-linked evidence and rejects without partial capture", () => {
  const db = store();
  const first = db.captureObservation(
    observation("1", "FAIL diagnostic\n" + "x".repeat(240000)),
    { captureSource: "fixture" },
  );
  const second = db.captureObservation(observation("2"), {
    captureSource: "fixture",
  });
  db.upsertCriterion({
    workspaceId: "test",
    sessionId: "session",
    text: "proof",
    provenance: "explicit_user",
    evidenceRefs: [db.getChunks(second.artifactId)[0].chunkId],
  });
  expect(() =>
    db.captureObservation(observation("3"), { captureSource: "fixture" }),
  ).toThrow(/quota/);
  expect(db.getArtifact(first.artifactId)).not.toBeNull();
  expect(db.getArtifact(second.artifactId)).not.toBeNull();
  expect(db.db.prepare("select count(*) as n from artifacts").get()).toEqual({
    n: 2,
  });
});
it("supports reject policy and idempotent replay at capacity", () => {
  const db = store("reject");
  const input = observation("1");
  const first = db.captureObservation(input, { captureSource: "fixture" });
  db.captureObservation(observation("2"), { captureSource: "fixture" });
  expect(
    db.captureObservation(input, { captureSource: "fixture" }).artifactId,
  ).toBe(first.artifactId);
  expect(() =>
    db.captureObservation(observation("3"), { captureSource: "fixture" }),
  ).toThrow(/quota/);
});
it("cleans expiry during writes and recovers an interrupted eviction", () => {
  const db = store();
  const first = db.captureObservation(observation("1", "example"), {
    captureSource: "fixture",
  });
  const file = path.join(db.artifactDir, `${first.artifactId}.txt`);
  fs.renameSync(file, `${file}.evict`);
  db.cleanupExpired();
  expect(fs.existsSync(file)).toBe(true);
  db.db.prepare("update artifacts set expires_at = '2000-01-01'").run();
  db.captureObservation(observation("2", "next"), { captureSource: "fixture" });
  expect(fs.existsSync(file)).toBe(false);
  expect(db.getArtifact(first.artifactId)).toBeNull();
});
it("rolls back files and metadata when SQLite reaches its partition limit", () => {
  const db = store();
  db.db.pragma(
    `max_page_count = ${db.db.pragma("page_count", { simple: true })}`,
  );
  expect(() =>
    db.captureObservation(observation("full"), { captureSource: "fixture" }),
  ).toThrow(/full/);
  expect(db.db.prepare("select count(*) as n from artifacts").get()).toEqual({
    n: 0,
  });
  expect(fs.readdirSync(db.artifactDir)).toEqual([]);
});
it("serializes quota admission across independent processes", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const db = store();
  const source = new URL("../src/store/evidenceStore.ts", import.meta.url).href;
  await Promise.all(
    ["a", "b", "c", "d"].map((id) =>
      promisify(execFile)(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {EvidenceStore} from ${JSON.stringify(source)}; const store = new EvidenceStore(${JSON.stringify(db.dataDir)}, {maxStoreBytes:6*1024*1024,quotaPolicy:"oldest_unprotected"}); try {store.captureObservation(${JSON.stringify(observation(id))},{captureSource:"fixture"});} finally {store.close();}`,
      ]),
    ),
  );
  const row = db.db
    .prepare("select sum(byte_length) as bytes, count(*) as n from artifacts")
    .get() as { bytes: number; n: number };
  expect(row.bytes).toBeLessThanOrEqual((6 * 1024 * 1024) / 12);
  expect(row.n).toBe(2);
  expect(fs.readdirSync(db.artifactDir).length).toBe(2);
});
