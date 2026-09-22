import { afterEach, expect, it, vi } from "vitest";
import { JevProvider, JEV_ENDPOINT } from "../src/providers/jev.js";
const config = {
  enabled: true,
  apiKey: "synthetic",
};
const input = {
  goal: "find failure",
  candidates: [{ id: "chunk-a", text: "test failed" }],
  privacyClass: "normal" as const,
};
afterEach(() => vi.unstubAllGlobals());
it("does not share without an API key, or for sensitive evidence", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    new JevProvider({ enabled: true }).classify(input),
  ).rejects.toThrow(/API key/);
  expect(
    await new JevProvider(config).classify({
      ...input,
      privacyClass: "sensitive",
    }),
  ).toEqual([]);
  expect(
    await new JevProvider({ ...config, enabled: false }).classify(input),
  ).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it("uses the official contract and maps probabilities to original IDs", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: { candidate_0: { type: "noul", noul: 0.95 } },
        usage: { input_tokens: 20, output_tokens: 0 },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await new JevProvider(config).classify(input)).toEqual([
    { id: "chunk-a", probability: 0.95, verdict: "relevant" },
  ]);
  expect(fetch.mock.calls[0][0]).toBe(JEV_ENDPOINT);
  const request = fetch.mock.calls[0][1];
  expect(request.redirect).toBe("error");
  expect(JSON.parse(request.body).questions.candidate_0.type).toBe("noul");
});
it("rejects mismatched answers, oversized payloads, and unverified destinations", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { unknown: { type: "noul", noul: 1 } },
          usage: { input_tokens: 1, output_tokens: 0 },
        }),
      ),
    ),
  );
  await expect(new JevProvider(config).classify(input)).rejects.toThrow(/IDs/);
  await expect(
    new JevProvider({ ...config, maxRequestBytes: 1 }).classify(input),
  ).rejects.toThrow(/budget/);
  await expect(
    new JevProvider({ ...config, endpoint: "https://example.com" }).classify(
      input,
    ),
  ).rejects.toThrow(/verified/);
});
it("passes through unchanged when provider fails", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { AlphaOptimizerEngine } = await import("../src/optimizer.js");
  const { loadConfig } = await import("../src/config.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-jev-engine-"));
  const engine = new AlphaOptimizerEngine(
    loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: dir,
      ALPHAOPTIMIZER_JEV_API_KEY: "synthetic",
      ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Synthetic outage")),
  );
  try {
    const result = await engine.captureAndSelect(
      {
        schemaVersion: "alphaoptimizer.contracts.v1",
        workspaceId: process.cwd(),
        sessionId: "test",
        toolCallId: "test",
        toolName: "test",
        inputHash: "synthetic-hash-for-test",
        status: "error",
        responseType: "text",
        captureCompleteness: "complete",
        privacyClass: "normal",
        content: "FAIL critical diagnostic\n\n" + "normal line\n".repeat(200),
      },
      { goal: "critical" },
    );
    expect(result.rendered).toContain("FAIL critical diagnostic");
    expect(result.selection).toBeNull();
    expect(result.artifact).toBeNull();
    expect(result.fallbackReason).toContain("jev unavailable");
  } finally {
    engine.store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
