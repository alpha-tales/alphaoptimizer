import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { VERSION } from "../src/contracts/schemas.js";
import { AlphaOptimizerEngine } from "../src/optimizer.js";
import { sha256 } from "../src/util/hash.js";
import { estimateTokens } from "../src/util/hash.js";

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

describe("deterministic evidence selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retains failure evidence and allows original retrieval", async () => {
    mockJev();
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_MODE: "observe",
      ALPHAOPTIMIZER_DATA_DIR: path.join(os.tmpdir(), `alphaoptimizer-${Date.now()}`),
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ALPHAOPTIMIZER_SELECTION_TOKEN_BUDGET: "80",
      ALPHAOPTIMIZER_JEV_API_KEY: "synthetic"
    }));
    const content = [
      ...Array.from({ length: 80 }, (_, index) => `noise line ${index}`),
      "FAIL src/payment.test.ts > invoices > calculates GST",
      "AssertionError: expected 11 to equal 10",
      "Summary: 1 failed, 80 noisy lines"
    ].join("\n");

    const result = await engine.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "test-session",
      toolCallId: "tool-1",
      toolName: "npm test",
      inputHash: sha256("npm test"),
      status: "error",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content
    }, { goal: "why did payment tests fail" });

    expect(result.rendered).toContain("AssertionError");
    expect(result.selection?.omittedChunkCount).toBeGreaterThan(0);
    expect(result.artifact).not.toBeNull();
    const original = engine.store.readArtifactRange(result.artifact!.artifactId, 0, 100000);
    expect(original.text).toContain("noise line 0");
    expect(original.text).toContain("Summary: 1 failed");
    engine.store.close();
  });

  it("retains later pinned failures even when the optional budget is exhausted", async () => {
    mockJev();
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_MODE: "observe",
      ALPHAOPTIMIZER_DATA_DIR: path.join(os.tmpdir(), `alphaoptimizer-${crypto.randomUUID()}`),
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ALPHAOPTIMIZER_SELECTION_TOKEN_BUDGET: "40",
      ALPHAOPTIMIZER_JEV_API_KEY: "synthetic"
    }));
    const content = [
      "ERROR first failure",
      ...Array.from({ length: 70 }, (_, index) => `noise line ${index}`),
      "ERROR second failure"
    ].join("\n");

    const result = await engine.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "test-session-2",
      toolCallId: "tool-2",
      toolName: "npm test",
      inputHash: sha256("npm test 2"),
      status: "error",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content
    }, { goal: "all failures" });

    expect(result.rendered).toContain("ERROR first failure");
    expect(result.rendered).toContain("ERROR second failure");
    engine.store.close();
  });

  it("keeps adjacent failure diagnostics across chunk boundaries", async () => {
    mockJev();
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_MODE: "observe",
      ALPHAOPTIMIZER_DATA_DIR: path.join(os.tmpdir(), `alphaoptimizer-${crypto.randomUUID()}`),
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ALPHAOPTIMIZER_SELECTION_TOKEN_BUDGET: "1500",
      ALPHAOPTIMIZER_JEV_API_KEY: "synthetic"
    }));
    const content = [
      ...Array.from({ length: 39 }, (_, index) => `noise line ${index}`),
      "FAIL payment calculation",
      "Expected: 100",
      "Received: 0"
    ].join("\n");

    const result = await engine.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "test-session-3",
      toolCallId: "tool-3",
      toolName: "npm test",
      inputHash: sha256("npm test 3"),
      status: "error",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content
    }, { goal: "payment failure" });

    expect(result.rendered).toContain("FAIL payment calculation");
    expect(result.rendered).toContain("Expected: 100");
    expect(result.rendered).toContain("Received: 0");
    engine.store.close();
  });

  it("accounts for rendered response overhead in the token estimate", async () => {
    mockJev();
    const engine = new AlphaOptimizerEngine(loadConfig({
      ALPHAOPTIMIZER_MODE: "observe",
      ALPHAOPTIMIZER_DATA_DIR: path.join(os.tmpdir(), `alphaoptimizer-${crypto.randomUUID()}`),
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      ALPHAOPTIMIZER_SELECTION_TOKEN_BUDGET: "20",
      ALPHAOPTIMIZER_JEV_API_KEY: "synthetic"
    }));
    const result = await engine.captureAndSelect({
      schemaVersion: VERSION,
      workspaceId: process.cwd(),
      sessionId: "test-session-4",
      toolCallId: "tool-4",
      toolName: "npm test",
      inputHash: sha256("npm test 4"),
      status: "success",
      responseType: "text",
      captureCompleteness: "complete",
      privacyClass: "normal",
      content: "test passed\n"
    }, { goal: "test" });

    expect(result.selection?.estimatedTokens).toBeGreaterThanOrEqual(estimateTokens(result.rendered));
    if (estimateTokens(result.rendered) > 20) {
      expect(result.fallbackReason).toContain("budget");
    }
    engine.store.close();
  });
});
