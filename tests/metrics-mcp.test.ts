import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";
import { readMetrics, summarizeMetrics } from "../src/telemetry/summary.js";

it.each([true, false])(
  "records real MCP calls and flushes on disconnect (enabled=%s)",
  async (enabled) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-metrics-mcp-"));
    const client = new Client({ name: "metrics-test", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", path.resolve("src/server.ts")],
      cwd: process.cwd(),
      env: {
        ...process.env,
        ALPHAOPTIMIZER_DATA_DIR: dir,
        ALPHAOPTIMIZER_WORKSPACES: process.cwd(),
        ALPHAOPTIMIZER_JEV_ENABLED: "false",
        ALPHAOPTIMIZER_METRICS_ENABLED: String(enabled),
        ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1",
      },
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const captured = await client.callTool({
        name: "select_evidence",
        arguments: {
          workspace: process.cwd(),
          content: "PRIVATE_TEST_DATA\n".repeat(100),
          toolName: "SECRET_COMMAND",
        },
      });
      expect(captured.isError).not.toBe(true);
      const receipt = JSON.parse(
        (captured.content as Array<{ text: string }>)[0].text,
      );
      expect(receipt.artifact).toBeNull();
      expect(receipt.selectedText).toBe("PRIVATE_TEST_DATA\n".repeat(100));
      expect(receipt.fallbackReason).toContain("jev unavailable");
      const failed = await client.callTool({
        name: "read_artifact",
        arguments: {
          workspace: process.cwd(),
          artifactId: "unknown",
        },
      });
      expect(failed.isError).toBe(true);
      await client.close();
      const { events } = await readMetrics(path.join(dir, "metrics"));
      expect(events.length).toBe(enabled ? 3 : 0);
      if (enabled) {
        expect(JSON.stringify(events)).not.toMatch(
          /PRIVATE_TEST_DATA|SECRET_COMMAND/,
        );
        const summary = summarizeMetrics(events);
        expect(summary.selectionRequests).toBe(1);
        expect(summary.failedToolCalls).toBe(1);
        expect(
          summary.toolResponses.find((e) => e.operation === "read_artifact")
            ?.calls,
        ).toBe(1);
        expect(
          events
            .filter((e) => e.kind === "tool" && e.status === "ok")
            .every((e) => e.kind === "tool" && e.responseTokensEstimate! > 0),
        ).toBe(true);
      }
    } finally {
      await client.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
