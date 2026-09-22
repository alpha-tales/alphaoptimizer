import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EvidenceStore } from "../src/store/evidenceStore.js";
import { AlphaOptimizerEngine } from "../src/optimizer.js";
import { loadConfig } from "../src/config.js";
import { ToolObservation, VERSION } from "../src/contracts/schemas.js";
import { chunkText } from "../src/parsers/text.js";
import {
  selectDeterministic,
  selectDeterministicAsync,
  renderSelection,
} from "../src/selection/deterministic.js";
import { estimateTokens } from "../src/util/hash.js";
import { searchRepository } from "../src/repository/search.js";
const dirs: string[] = [];
const stores: EvidenceStore[] = [];
function dir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-r3-"));
  dirs.push(value);
  return value;
}
function observation(id: string, content: string): ToolObservation {
  return {
    schemaVersion: VERSION,
    workspaceId: process.cwd(),
    sessionId: "r3",
    toolCallId: id,
    toolName: "test",
    inputHash: "synthetic-hash-123456",
    status: "success",
    responseType: "text",
    captureCompleteness: "complete",
    privacyClass: "normal",
    content,
  };
}
function store() {
  const value = new EvidenceStore(dir(), {
    maxStoreBytes: 6 * 1024 * 1024,
    quotaPolicy: "oldest_unprotected",
  });
  stores.push(value);
  return value;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const value of stores.splice(0)) value.close();
  for (const value of dirs.splice(0))
    fs.rmSync(value, { recursive: true, force: true });
});
it("does not store an artifact while Jev is pending or after Jev fails", async () => {
  const db = store();
  const engine = new AlphaOptimizerEngine(
    loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: db.dataDir,
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ALPHAOPTIMIZER_JEV_API_KEY: "synthetic",
    }),
    db,
  );
  let reject!: (error: Error) => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => (entered = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      entered();
      return new Promise((_resolve, rejectPromise) => (reject = rejectPromise));
    }),
  );
  const first = engine.captureAndSelect(
    observation("pending", "routine ".repeat(1000)),
  );
  await ready;
  const second = new EvidenceStore(db.dataDir, {
    maxStoreBytes: 6 * 1024 * 1024,
    quotaPolicy: "oldest_unprotected",
  });
  stores.push(second);
  expect(second.db.prepare("select count(*) n from artifacts").get()).toEqual({
    n: 0,
  });
  reject(new Error("synthetic outage"));
  const result = await first;
  expect(result.artifact).toBeNull();
  expect(result.selection).toBeNull();
  expect(result.rendered).toBe("routine ".repeat(1000));
  expect(result.fallbackReason).toContain("jev unavailable");
  expect(second.db.prepare("select count(*) n from artifacts").get()).toEqual({
    n: 0,
  });
});
it("returns match-centered windows with exact byte/line ranges and usable continuation", () => {
  const db = store();
  const content =
    "😀 prefix\n" +
    "a".repeat(3000) +
    " TARGET_NEEDLE " +
    "b".repeat(3000) +
    " TARGET_NEEDLE\n";
  const artifact = db.captureObservation(observation("search", content), {
    captureSource: "fixture",
  });
  const first = db.searchArtifactText(
    artifact.artifactId,
    "TARGET_NEEDLE",
    100,
  );
  expect(first.chunks[0].text).toContain("TARGET_NEEDLE");
  expect(first.hasMore).toBe(true);
  expect(first.omittedChunks).toBeGreaterThan(0);
  const next = db.searchArtifactText(
    artifact.artifactId,
    "TARGET_NEEDLE",
    100,
    undefined,
    first.nextCursor!,
  );
  expect(next.chunks[0].text).toContain("TARGET_NEEDLE");
  expect(next.hasMore).toBe(false);
  for (const hit of [...first.chunks, ...next.chunks]) {
    expect(
      Buffer.from(content).subarray(hit.startByte, hit.endByte).toString(),
    ).toBe(hit.text);
    expect(hit.startLine).toBe(2);
    expect(hit.endLine).toBe(2);
  }
  expect(() =>
    db.searchArtifactText(
      artifact.artifactId,
      "other",
      100,
      undefined,
      first.nextCursor!,
    ),
  ).toThrow(/cursor/);
});
it("continues beyond fifty matching chunks without missing hits", () => {
  const db = store();
  const content = Array.from(
    { length: 65 },
    (_, i) => `TARGET_${i}\n` + ("noise ".repeat(10) + "\n").repeat(39),
  ).join("");
  const artifact = db.captureObservation(observation("many", content), {
    captureSource: "fixture",
  });
  let cursor: string | null = null;
  const texts: string[] = [];
  do {
    const result = db.searchArtifactText(
      artifact.artifactId,
      "TARGET_",
      100000,
      undefined,
      cursor ?? undefined,
    );
    texts.push(...result.chunks.map((chunk) => chunk.text));
    cursor = result.nextCursor;
  } while (cursor);
  expect(texts.length).toBe(65);
});
it("pins diagnostic records at every chunk position without duplicate text", () => {
  for (let position = 0; position < 40; position++)
    for (const details of [4, 45, 90]) {
      const content = [
        ...Array(position).fill("noise"),
        "FAIL unique-marker",
        ...Array(details).fill("diagnostic detail"),
        "Expected: 100",
        "Received: 0",
        "",
        "PASS done",
      ].join("\n");
      const chunks = chunkText("artifact", content);
      const selection = selectDeterministic(chunks, { tokenBudget: 1500 });
      const text = renderSelection(chunks, selection);
      expect(text).toContain("Expected: 100");
      expect(text).toContain("Received: 0");
      expect(text.split("unique-marker").length).toBe(2);
    }
});
it("bounds chunk count, yields during selection, and exactly budgets final output", async () => {
  expect(
    chunkText("artifact", "x\n".repeat(200000)).length,
  ).toBeLessThanOrEqual(4096);
  for (const count of [1000, 4000, 8000]) {
    const chunks = Array.from({ length: count }, (_, i) => ({
      ...chunkText("artifact", `test ${i} passed\n`)[0],
      chunkId: `id-${i}`,
      startByte: i * 100,
      endByte: i * 100 + 20,
    }));
    let ticked = false;
    setImmediate(() => (ticked = true));
    const selection = await selectDeterministicAsync(chunks, {
      tokenBudget: 1500,
      providerStatus: "jev-used",
    });
    expect(ticked).toBe(true);
    expect(selection.estimatedTokens).toBe(
      estimateTokens(renderSelection(chunks, selection)),
    );
    expect(selection.estimatedTokens).toBeLessThanOrEqual(1500);
  }
});
it.each(["insert", "remove"])(
  "rejects stale ripgrep line locations after %s",
  async (change) => {
    const workspace = dir();
    const bin = dir();
    const file = path.join(workspace, "a.txt");
    fs.writeFileSync(file, "before\nneedle\n");
    const event = {
      type: "match",
      data: {
        path: { text: fs.realpathSync(file) },
        line_number: 2,
        lines: { text: "needle\n" },
      },
    };
    fs.writeFileSync(
      path.join(bin, "rg"),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(file)},${JSON.stringify(change === "insert" ? "inserted\nbefore\nneedle\n" : "before\nremoved\n")});console.log(${JSON.stringify(JSON.stringify(event))});`,
      { mode: 0o700 },
    );
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
    await expect(
      searchRepository({ workspace, query: "needle" }),
    ).rejects.toThrow(/changed during search/);
  },
);
it("never exceeds the search byte budget when Unicode context straddles the boundary", () => {
  const db = store();
  const artifact = db.captureObservation(
    observation("unicode", "😀".repeat(10) + "needle" + "😀".repeat(10)),
    { captureSource: "fixture" },
  );
  for (const budget of [6, 7, 8, 9, 10, 13, 17]) {
    const result = db.searchArtifactText(artifact.artifactId, "needle", budget);
    expect(result.chunks[0].text).toContain("needle");
    expect(Buffer.byteLength(result.chunks[0].text)).toBeLessThanOrEqual(
      budget,
    );
    expect(result.chunks[0].text).not.toContain("�");
  }
});
it("honors a durable lease from an independent process", async () => {
  const db = store();
  const artifact = db.captureObservation(
    observation("owner", "x".repeat(8000)),
    { captureSource: "fixture", leaseId: "crashed-owner" },
  );
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const source = new URL("../src/store/evidenceStore.ts", import.meta.url).href;
  const command = `import {EvidenceStore} from ${JSON.stringify(source)}; const store=new EvidenceStore(${JSON.stringify(db.dataDir)},{maxStoreBytes:6*1024*1024,quotaPolicy:"oldest_unprotected"});try{store.captureObservation({...${JSON.stringify(observation("other", ""))},content:"x".repeat(520000)},{captureSource:"fixture"});process.exitCode=1;}catch(error){if(!error.message.includes("quota")) throw error;}finally{store.close();}`;
  await promisify(execFile)(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    command,
  ]);
  expect(db.getArtifact(artifact.artifactId)).not.toBeNull();
});

it("finds and paginates multiline hits across storage chunk boundaries", () => {
  const db = store();
  const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
  for (const boundary of [40, 80]) {
    lines[boundary - 1] = "before";
    lines[boundary] = "after";
  }
  const content = lines.join("\n");
  const artifact = db.captureObservation(observation("cross-chunk", content), {
    captureSource: "fixture",
  });
  const query = "before\nafter";
  const first = db.searchArtifactText(
    artifact.artifactId,
    query,
    Buffer.byteLength(query),
  );
  const second = db.searchArtifactText(
    artifact.artifactId,
    query,
    Buffer.byteLength(query),
    undefined,
    first.nextCursor!,
  );
  expect(first.chunks[0].text).toBe(query);
  expect(first.chunks[0].startLine).toBe(40);
  expect(first.chunks[0].endLine).toBe(41);
  expect(first.chunks[0].sourceChunkIds).toHaveLength(2);
  expect(second.chunks[0].startLine).toBe(80);
  expect(second.hasMore).toBe(false);
  for (const window of [...first.chunks, ...second.chunks])
    expect(
      Buffer.from(content)
        .subarray(window.startByte, window.endByte)
        .toString(),
    ).toBe(window.text);
});

it.each(["界".repeat(500), "😀".repeat(400)])(
  "accepts Unicode hits larger than the context target (%#)",
  (query) => {
    const db = store();
    const content = `prefix ${query} middle ${query} suffix`;
    const artifact = db.captureObservation(
      observation("large-unicode", content),
      { captureSource: "fixture" },
    );
    const budget = Buffer.byteLength(query);
    const first = db.searchArtifactText(artifact.artifactId, query, budget);
    expect(first.chunks[0].text).toBe(query);
    expect(first.hasMore).toBe(true);
    const second = db.searchArtifactText(
      artifact.artifactId,
      query,
      budget,
      undefined,
      first.nextCursor!,
    );
    expect(second.chunks[0].text).toBe(query);
    expect(second.hasMore).toBe(false);
    expect(() =>
      db.searchArtifactText(artifact.artifactId, query, budget - 1),
    ).toThrow(/smaller than/);
  },
);

it("preserves U+FEFF at artifact, context, and match boundaries byte for byte", () => {
  const db = store();
  const content =
    "\uFEFFprefix needle\uFEFFtail\n" +
    "padding ".repeat(200) +
    "needle\uFEFFtail";
  const artifact = db.captureObservation(observation("bom", content), {
    captureSource: "fixture",
  });
  for (const query of ["needle", "\uFEFF", "needle\uFEFFtail"]) {
    let cursor: string | null = null;
    let count = 0;
    do {
      const result = db.searchArtifactText(
        artifact.artifactId,
        query,
        25,
        undefined,
        cursor ?? undefined,
      );
      for (const window of result.chunks) {
        expect(
          Buffer.from(content)
            .subarray(window.startByte, window.endByte)
            .toString("utf8"),
        ).toBe(window.text);
        expect(window.text).toContain(query);
        expect(Buffer.byteLength(window.text)).toBeLessThanOrEqual(25);
      }
      cursor = result.nextCursor;
      if (++count > 10) throw new Error("Cursor failed to progress");
    } while (cursor);
  }
  expect(db.readArtifactRange(artifact.artifactId, 0, 3).text).toBe("\uFEFF");
});

it("keeps dense matches visible when windows span several indexed chunks", () => {
  const db = store();
  const content = Array.from(
    { length: 65 },
    (_, i) => `TARGET_${i}\n` + "noise\n".repeat(39),
  ).join("");
  const artifact = db.captureObservation(observation("dense", content), {
    captureSource: "fixture",
  });
  let cursor: string | null = null;
  const texts: string[] = [];
  do {
    const result = db.searchArtifactText(
      artifact.artifactId,
      "TARGET_",
      1024,
      undefined,
      cursor ?? undefined,
    );
    texts.push(...result.chunks.map((chunk) => chunk.text));
    cursor = result.nextCursor;
  } while (cursor);
  for (let i = 0; i < 65; i++)
    expect(texts.some((text) => text.includes(`TARGET_${i}\n`))).toBe(true);
});
