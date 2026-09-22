import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { VERSION } from "../src/contracts/schemas.js";
import { AlphaOptimizerEngine } from "../src/optimizer.js";
import { searchRepository } from "../src/repository/search.js";
import { sha256 } from "../src/util/hash.js";
import { handleHook } from "../src/hooks/adapter.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function jevEnv() {
  return { ALPHAOPTIMIZER_JEV_API_KEY: "synthetic" };
}

function mockJev(probability = 0.95) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const questions = JSON.parse((init as RequestInit).body as string)
        .questions;
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: Object.fromEntries(
            Object.keys(questions).map((key) => [
              key,
              { type: "noul", noul: probability },
            ]),
          ),
          usage: { input_tokens: 1, output_tokens: 0 },
        }),
      );
    }),
  );
}

describe("security boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not return symlinked or sensitive fallback files", async () => {
    const workspace = tmpDir("alphaoptimizer-ws-");
    const outside = tmpDir("alphaoptimizer-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside synthetic secret needle");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(workspace, "linked-secret.txt"));
    fs.writeFileSync(path.join(workspace, ".env"), "needle=hidden");
    fs.writeFileSync(path.join(workspace, "visible.txt"), "needle visible");

    const results = await searchRepository({
      workspace,
      query: "needle missingterm",
      limit: 10
    });

    expect(results.map((result) => result.path)).toEqual(["visible.txt"]);
  });

  it("requires matching workspace and session to read artifacts", async () => {
    const workspaceA = tmpDir("alphaoptimizer-a-");
    const workspaceB = tmpDir("alphaoptimizer-b-");
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: tmpDir("alphaoptimizer-store-"),
      ALPHAOPTIMIZER_WORKSPACES: `${workspaceA}:${workspaceB}`,
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ...jevEnv()
    }));
    mockJev();

    const captured = await engine.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: workspaceA,
      sessionId: "session-a",
      toolCallId: "tool",
      toolName: "tool",
      inputHash: sha256("tool"),
      status: "success",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content: "private synthetic content"
    });

    expect(captured.artifact).not.toBeNull();
    expect(() => engine.store.readArtifactRange(captured.artifact!.artifactId, 0, 100, {
      workspaceId: fs.realpathSync(workspaceB),
      sessionId: "session-a"
    })).toThrow(/Unknown artifact/);
    engine.store.close();
  });

  it("short-circuits capture in off mode and for oversized content", async () => {
    const disabled = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_MODE: "off",
      ALPHAOPTIMIZER_DATA_DIR: tmpDir("alphaoptimizer-off-")
    }));
    const offResult = await disabled.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "s",
      toolCallId: "t",
      toolName: "tool",
      inputHash: sha256("tool"),
      status: "success",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content: "do not store"
    });
    expect(offResult.artifact).toBeNull();
    disabled.store.close();

    const limited = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: tmpDir("alphaoptimizer-limit-"),
      ALPHAOPTIMIZER_MAX_ARTIFACT_BYTES: "4"
    }));
    const largeResult = await limited.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "s",
      toolCallId: "t",
      toolName: "tool",
      inputHash: sha256("tool"),
      status: "success",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content: "too large"
    });
    expect(largeResult.fallbackReason).toContain("maxArtifactBytes");
    expect(largeResult.artifact).toBeNull();
    limited.store.close();
  });

  it("paginates artifact text on UTF-8 boundaries", async () => {
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: tmpDir("alphaoptimizer-utf8-"),
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ...jevEnv()
    }));
    mockJev();
    const content = "alpha 😊 omega";
    const captured = await engine.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "utf8",
      toolCallId: "tool",
      toolName: "tool",
      inputHash: sha256("tool"),
      status: "success",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content
    });

    const scope = {
      workspaceId: fs.realpathSync(process.cwd()),
      sessionId: "utf8"
    };
    const first = engine.store.readArtifactRange(captured.artifact!.artifactId, 0, 8, scope);
    const second = engine.store.readArtifactRange(captured.artifact!.artifactId, first.nextCursor!, 100, scope);

    expect(first.text + second.text).toBe(content);
    engine.store.close();
  });

  it("makes UTF-8 progress for leading multibyte characters and rejects mid-character cursors", async () => {
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: tmpDir("alphaoptimizer-utf8-progress-"),
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ...jevEnv()
    }));
    mockJev();
    const captured = await engine.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "utf8-progress",
      toolCallId: "tool",
      toolName: "tool",
      inputHash: sha256("tool"),
      status: "success",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content: "😀X"
    });
    const scope = {
      workspaceId: fs.realpathSync(process.cwd()),
      sessionId: "utf8-progress"
    };
    const first = engine.store.readArtifactRange(captured.artifact!.artifactId, 0, 2, scope);
    expect(first.text).toBe("😀");
    expect(first.nextCursor).toBe(4);
    expect(() => engine.store.readArtifactRange(captured.artifact!.artifactId, 1, 2, scope)).toThrow(/Invalid UTF-8 cursor/);
    engine.store.close();
  });

  it("bounds artifact search results by maxBytes", async () => {
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: tmpDir("alphaoptimizer-search-bound-"),
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ...jevEnv()
    }));
    mockJev();
    const captured = await engine.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "search-bound",
      toolCallId: "tool",
      toolName: "tool",
      inputHash: sha256("tool"),
      status: "success",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content: `needle ${"x".repeat(5000)}`
    });
    const search = engine.store.searchArtifactText(captured.artifact!.artifactId, "needle", 128, {
      workspaceId: fs.realpathSync(process.cwd()),
      sessionId: "search-bound"
    });
    expect(Buffer.byteLength(search.chunks.map((chunk) => chunk.text).join(""))).toBeLessThanOrEqual(128);
    expect(search.omittedChunks).toBeGreaterThanOrEqual(0);
    engine.store.close();
  });

  it("does not capture hook output marked secret", async () => {
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: tmpDir("alphaoptimizer-hook-secret-"),
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1"
    }));
    const response = await handleHook(engine, {
      event: "PostToolUse",
      workspace: process.cwd(),
      sessionId: "hook-secret",
      toolCallId: "tool",
      toolName: "tool",
      output: "synthetic secret",
      privacyClass: "secret",
      captureCompleteness: "truncated"
    });
    expect(response.artifactId).toBeNull();
    expect(response.fallbackReason).toContain("secret");
    engine.store.close();
  });

  it("parses boolean environment variables strictly", () => {
    expect(loadConfig({}).workspaceAllowlist).toEqual([]);
    expect(loadConfig({ ALPHAOPTIMIZER_JEV_API_KEY: "synthetic" }).jevEnabled).toBe(true);
    expect(loadConfig({ ALPHAOPTIMIZER_JEV_ENABLED: "false", ALPHAOPTIMIZER_JEV_API_KEY: "synthetic" }).jevEnabled).toBe(false);
  });
});
