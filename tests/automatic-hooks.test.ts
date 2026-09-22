import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AlphaOptimizerEngine } from "../src/optimizer.js";
import { loadConfig } from "../src/config.js";
import { processToolResult } from "../src/hooks/automatic.js";
import { Metric } from "../src/telemetry/metrics.js";
import { mergeOutputPolicy, POLICY_START } from "../src/hooks/policy.js";

const resources: Array<{ engine: AlphaOptimizerEngine; dir: string }> = [];
it("installs the emission policy idempotently without replacing other instructions", () => {
  const original = "# Existing rules\nKeep my formatting preferences.\n";
  const enabled = mergeOutputPolicy(original, true);
  expect(enabled.startsWith(original)).toBe(true);
  expect(mergeOutputPolicy(enabled, true)).toBe(enabled);
  expect(mergeOutputPolicy(enabled, false)).toContain(original);
  expect(mergeOutputPolicy(enabled, false)).not.toContain(POLICY_START);
  expect(() => mergeOutputPolicy(original + POLICY_START, true)).toThrow(
    /Incomplete/,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const { engine, dir } of resources.splice(0)) {
    engine.store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function setup(autoMode = "filter") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-auto-unit-"));
  const metrics: Metric[] = [];
  const engine = new AlphaOptimizerEngine(
    loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: path.join(dir, "store"),
      ALPHAOPTIMIZER_AUTO_MODE: autoMode,
      ALPHAOPTIMIZER_JEV_API_KEY: "synthetic",
    }),
    undefined,
    { record: (m) => metrics.push(m) },
  );
  resources.push({ engine, dir });
  const text =
    Array.from(
      { length: 240 },
      (_, i) =>
        `Routine line ${i}: ` + "ordinary background processing ".repeat(3),
    ).join("\n") + "\nERROR keep this diagnostic\n";
  const event = {
    hook_event_name: "PostToolUse",
    cwd: dir,
    session_id: "host-session",
    tool_use_id: "host-call",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: text,
    exit_code: 0,
  };
  return { engine, event, metrics, dir, text };
}
it("automatically reduces plain text, keeps diagnostics, and makes the exact original retrievable", async () => {
  const { engine, event, metrics, text } = setup();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const result = await processToolResult(engine, event);
  expect(result.continue).toBe(false);
  expect(result.stopReason).toContain("ERROR keep this diagnostic");
  expect(result.stopReason!.length).toBeLessThan(text.length * 0.85);
  const recovery = JSON.parse(result.stopReason!).recovery;
  expect(
    engine.store.readArtifactRange(recovery.artifactId, 0, 100000).text,
  ).toBe(text);
  expect(result).not.toHaveProperty("hookSpecificOutput");
  expect(fetch).not.toHaveBeenCalled();
  expect(metrics.at(-1)).toMatchObject({
    kind: "hook",
    decision: "replacement_requested",
  });
});
it.each(["off", "observe"])("never replaces in %s mode", async (mode) => {
  const { engine, event, metrics } = setup(mode);
  expect(await processToolResult(engine, event)).toEqual({});
  expect(metrics.at(-1)).toMatchObject({ decision: "pass_through" });
});
it.each([
  ["small", "Bash", "short"],
  ["self", "mcp__alphaoptimizer__read_artifact", "large"],
  ["unsupported", "apply_patch", "large"],
  ["sensitive", "mcp__vault__read", "large"],
  ["running", "Bash", "Process running with session ID 123\n"],
  ["truncated", "Bash", "Output truncated\n"],
])("passes through %s without capturing", async (reason, name, prefix) => {
  const { engine, event, metrics, text } = setup();
  const output = reason === "small" ? prefix : prefix + text;
  expect(
    await processToolResult(engine, {
      ...event,
      tool_name: name,
      tool_response: output,
    }),
  ).toEqual({});
  expect(metrics.at(-1)).toMatchObject({ reason });
  expect(
    engine.store.db.prepare("select count(*) n from artifacts").get(),
  ).toEqual({ n: 0 });
});
it("never changes structured, error, mixed-media, or secret-bearing MCP results", async () => {
  const { engine, event, metrics, text } = setup();
  for (const response of [
    { content: [{ type: "image", data: "synthetic", mimeType: "image/png" }] },
    {
      content: [{ type: "text", text }],
      structuredContent: { required: true },
    },
    { content: [{ type: "text", text }], isError: true },
    { content: [{ type: "text", text: text + "\nAPI_KEY=synthetic-secret" }] },
    JSON.stringify({ important: text }),
  ])
    expect(
      await processToolResult(engine, {
        ...event,
        tool_name: "mcp__fixture__read",
        tool_response: response,
      }),
    ).toEqual({});
  expect(
    engine.store.db.prepare("select count(*) n from artifacts").get(),
  ).toEqual({ n: 0 });
  expect(JSON.stringify(metrics)).not.toContain("synthetic-secret");
});
it("fails open on storage failure and abort", async () => {
  const { engine, event } = setup();
  expect(await processToolResult(engine, event, AbortSignal.abort())).toEqual(
    {},
  );
  vi.spyOn(engine.store, "captureObservation").mockImplementation(() => {
    throw new Error("synthetic failure");
  });
  expect(await processToolResult(engine, event)).toEqual({});
});
it("accepts any cwd by default and enforces an explicit allowlist when configured", async () => {
  const { event, text } = setup();
  const unrestrictedStore = fs.mkdtempSync(
    path.join(os.tmpdir(), "alpha-global-store-"),
  );
  const unrestricted = new AlphaOptimizerEngine(
    loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: unrestrictedStore,
      ALPHAOPTIMIZER_AUTO_MODE: "filter",
    }),
  );
  resources.push({ engine: unrestricted, dir: unrestrictedStore });
  expect(
    await processToolResult(unrestricted, {
      ...event,
      cwd: os.tmpdir(),
      tool_response: text,
    }),
  ).toHaveProperty("continue", false);

  const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-allowed-"));
  const restrictedStore = fs.mkdtempSync(
    path.join(os.tmpdir(), "alpha-restricted-store-"),
  );
  const restricted = new AlphaOptimizerEngine(
    loadConfig({
      ALPHAOPTIMIZER_DATA_DIR: restrictedStore,
      ALPHAOPTIMIZER_AUTO_MODE: "filter",
      ALPHAOPTIMIZER_WORKSPACES: allowedRoot,
    }),
  );
  resources.push({ engine: restricted, dir: restrictedStore });
  expect(
    await processToolResult(restricted, {
      ...event,
      cwd: os.tmpdir(),
      tool_response: text,
    }),
  ).toEqual({});
});
it("preserves native shell status when the hook does not expose it, and never filters failed commands", async () => {
  const { engine, event, metrics } = setup();
  expect(
    await processToolResult(engine, { ...event, exit_code: undefined }),
  ).toEqual({});
  expect(metrics.at(-1)).toMatchObject({ reason: "status_unknown" });
  expect(await processToolResult(engine, { ...event, exit_code: 7 })).toEqual(
    {},
  );
  expect(metrics.at(-1)).toMatchObject({ reason: "error_result" });
});
it("recognizes a cwd beneath the authorized root and accepts text-only MCP output", async () => {
  const { engine, event, dir, text } = setup();
  const cwd = path.join(dir, "sub");
  fs.mkdirSync(cwd);
  const result = await processToolResult(engine, {
    ...event,
    cwd,
    tool_name: "mcp__fixture__read",
    tool_response: { content: [{ type: "text", text }] },
  });
  expect(result.continue).toBe(false);
});
