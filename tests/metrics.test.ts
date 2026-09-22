import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  BufferedMetrics,
  Metric,
  recordSafely,
} from "../src/telemetry/metrics.js";
import { readMetrics, summarizeMetrics } from "../src/telemetry/summary.js";
import { AlphaOptimizerEngine } from "../src/optimizer.js";
import { loadConfig } from "../src/config.js";
import { ToolObservation } from "../src/contracts/schemas.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
async function temp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-metrics-"));
  dirs.push(dir);
  return dir;
}
function event(): Metric {
  return {
    version: 1,
    at: new Date().toISOString(),
    requestId: randomUUID(),
    artifactId: null,
    kind: "tool",
    operation: "read_artifact",
    durationMs: 1,
    status: "ok",
    responseTokensEstimate: 3,
  };
}
function observation(): ToolObservation {
  return {
    schemaVersion: "alphaoptimizer.contracts.v1",
    workspaceId: process.cwd(),
    sessionId: "SENSITIVE_SESSION",
    toolCallId: randomUUID(),
    toolName: "SENSITIVE_COMMAND",
    inputHash: "1234567890123456",
    status: "success",
    responseType: "text",
    captureCompleteness: "complete",
    privacyClass: "normal",
    content: "PRIVATE_CONTENT\n" + "ordinary text\n".repeat(80),
  };
}

it("buffers without disk work, bounds backlog during a slow flush, and drops overflow", async () => {
  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi.fn(() => slow);
  const logger = new BufferedMetrics(await temp(), {
    maxQueue: 2,
    batchSize: 1,
    writeBatch: write,
  });
  logger.record(event());
  expect(write).not.toHaveBeenCalled();
  const flush = logger.flush();
  logger.record(event());
  logger.record(event());
  logger.record(event());
  expect(logger.health.dropped).toBe(1);
  release();
  await flush;
  await logger.close();
  expect(logger.health.written).toBe(3);
});

it("contains disk errors and allows later batches without logging the error text", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error("SECRET_IN_ERROR"))
    .mockResolvedValue(undefined);
  const logger = new BufferedMetrics(await temp(), { writeBatch: write });
  logger.record(event());
  await expect(logger.flush()).resolves.toBeUndefined();
  logger.record(event());
  await logger.close();
  expect(logger.health).toMatchObject({
    written: 1,
    dropped: 1,
    writeFailures: 1,
  });
  expect(JSON.stringify(stderr.mock.calls)).not.toContain("SECRET_IN_ERROR");
});

it("does not block shutdown indefinitely on a hung writer", async () => {
  const logger = new BufferedMetrics(await temp(), {
    writeBatch: () => new Promise(() => {}),
  });
  logger.record(event());
  await logger.close(10);
  expect(logger.health.written).toBe(0);
});

it("projects safe fields, creates private logs, rotates and tolerates a partial final line", async () => {
  const dir = await temp();
  const logger = new BufferedMetrics(dir, { maxFileBytes: 700 });
  for (let i = 0; i < 8; i++) {
    logger.record({
      ...event(),
      content: "PRIVATE_PROMPT",
      apiKey: "PRIVATE_KEY",
    } as unknown as Metric);
    await logger.flush();
  }
  await logger.close();
  const names = await fs.readdir(logger.directory);
  expect(names).toHaveLength(2);
  for (const name of names) {
    const file = path.join(logger.directory, name);
    expect((await fs.stat(file)).size).toBeLessThanOrEqual(700);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const text = await fs.readFile(file, "utf8");
    expect(text).not.toContain("PRIVATE");
  }
  await fs.appendFile(logger.filename, '{"incomplete":');
  const report = await readMetrics(logger.directory);
  expect(report.events.length).toBeGreaterThan(0);
  expect(report.skipped).toBe(1);
});

it("uses separate files for simultaneous writers", async () => {
  const dir = await temp();
  const a = new BufferedMetrics(dir),
    b = new BufferedMetrics(dir);
  a.record(event());
  b.record(event());
  await Promise.all([a.close(), b.close()]);
  expect((await readMetrics(a.directory)).events).toHaveLength(2);
});

it("captures Jev usage and timings without any source or credentials", async () => {
  const events: Metric[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const questions = JSON.parse(init.body).questions;
      return new Response(
        JSON.stringify({
          model: "untrusted-model-text",
          usage: { input_tokens: 42, output_tokens: 0 },
          answers: Object.fromEntries(
            Object.keys(questions).map((key) => [
              key,
              { type: "noul", noul: 0.9 },
            ]),
          ),
        }),
      );
    }),
  );
  const config = loadConfig({
    ALPHAOPTIMIZER_DATA_DIR: await temp(),
    ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
    ALPHAOPTIMIZER_JEV_ENABLED: "true",
    ALPHAOPTIMIZER_JEV_DATA_SHARING: "true",
    ALPHAOPTIMIZER_JEV_TERMS_ACCEPTED: "true",
    ALPHAOPTIMIZER_JEV_API_KEY: "PRIVATE_KEY",
  });
  const engine = new AlphaOptimizerEngine(config, undefined, {
    record: (e) => events.push(e),
  });
  try {
    const result = await engine.captureAndSelect(observation(), {
      goal: "PRIVATE_GOAL",
    });
    expect(result.artifact).not.toBeNull();
    expect(events[0]).toMatchObject({
      provider: "success",
      providerAttempted: true,
      providerInputTokens: 42,
      providerOutputTokens: 0,
      status: "ok",
    });
    expect(JSON.stringify(events)).not.toMatch(
      /PRIVATE|SENSITIVE|untrusted-model/,
    );
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
  } finally {
    engine.store.close();
  }
});

it("records unknown provider usage on failure, cancellation, and no request for private data", async () => {
  const events: Metric[] = [];
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SECRET_ERROR")));
  const config = loadConfig({
    ALPHAOPTIMIZER_DATA_DIR: await temp(),
    ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
    ALPHAOPTIMIZER_JEV_ENABLED: "true",
    ALPHAOPTIMIZER_JEV_DATA_SHARING: "true",
    ALPHAOPTIMIZER_JEV_TERMS_ACCEPTED: "true",
    ALPHAOPTIMIZER_JEV_API_KEY: "PRIVATE_KEY",
  });
  const engine = new AlphaOptimizerEngine(config, undefined, {
    record: (e) => events.push(e),
  });
  try {
    await engine.captureAndSelect(observation());
    expect(events[0]).toMatchObject({
      provider: "fallback",
      providerAttempted: true,
      providerInputTokens: null,
    });
    await engine.captureAndSelect({ ...observation(), privacyClass: "secret" });
    expect(events[1]).toMatchObject({
      provider: "not_run",
      fallback: "privacy",
      artifactId: null,
    });
    await expect(
      engine.captureAndSelect(observation(), { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(events[2]).toMatchObject({
      status: "cancelled",
      outputTokensEstimate: null,
    });
    expect(JSON.stringify(events)).not.toContain("SECRET_ERROR");
    const report = summarizeMetrics(events);
    expect(report.provider.requestsWithoutUsage).toBe(1);
  } finally {
    engine.store.close();
  }
});

it("does not let an unavailable metrics sink change the engine result", async () => {
  const engine = new AlphaOptimizerEngine(
    loadConfig({ ALPHAOPTIMIZER_DATA_DIR: await temp() }),
    undefined,
    {
      record: () => {
        throw new Error("sink unavailable");
      },
    },
  );
  try {
    expect(
      (await engine.captureAndSelect(observation())).artifact,
    ).not.toBeNull();
  } finally {
    engine.store.close();
  }
  expect(() => recordSafely(undefined, event())).not.toThrow();
  expect(
    loadConfig({ ALPHAOPTIMIZER_METRICS_ENABLED: "false" }).metricsEnabled,
  ).toBe(false);
});
