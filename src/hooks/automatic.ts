import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AlphaOptimizerEngine } from "../optimizer.js";
import { VERSION } from "../contracts/schemas.js";
import { estimateTokens, sha256 } from "../util/hash.js";
import { Metric, recordSafely } from "../telemetry/metrics.js";

export const HostToolEventSchema = z.object({
  hook_event_name: z.literal("PostToolUse"),
  cwd: z.string().min(1).max(8192),
  session_id: z.string().min(1).max(256),
  tool_use_id: z.string().min(1).max(512),
  tool_name: z.string().min(1).max(256),
  tool_input: z.unknown(),
  tool_response: z.unknown(),
  exit_code: z.number().int().nullable().optional(),
});
type HookMetric = Extract<Metric, { kind: "hook" }>;
type HostFeedback = { continue?: false; stopReason?: string };
const SECRET =
  /-----BEGIN [\w ]*PRIVATE KEY-----|\bBearer\s+[\w.+\/-]{12,}|\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|authorization|cookie)\s*["']?\s*[:=]\s*\S+|\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|AKIA[0-9A-Z]{16})|\beyJ[\w-]{8,}\.[\w-]+\.[\w-]+/i;
const SENSITIVE_INPUT =
  /agent-vault|\.env\b|\.npmrc\b|\.ssh\b|\.aws\b|\b(?:printenv|credential|password|secret|authorization|cookie|api[_-]?key)\b/i;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function textualResult(
  value: unknown,
): { text: string; isError: boolean; exitCode: number | null } | null {
  if (typeof value === "string")
    return { text: value, isError: false, exitCode: null };
  const result = object(value);
  if (!result) return null;
  // Preserve structured data, resource links, images and transport-specific values unchanged.
  if (Object.keys(result).some((key) => !["content", "isError"].includes(key)))
    return null;
  if (result.isError !== undefined && typeof result.isError !== "boolean")
    return null;
  if (!Array.isArray(result.content) || !result.content.length) return null;
  const blocks: string[] = [];
  for (const entry of result.content) {
    const block = object(entry);
    if (
      !block ||
      block.type !== "text" ||
      typeof block.text !== "string" ||
      Object.keys(block).some((key) => !["type", "text"].includes(key))
    )
      return null;
    blocks.push(block.text);
  }
  return {
    text: blocks.join("\n"),
    isError: result.isError === true,
    exitCode: null,
  };
}

/** No permission decisions, retries, command rewriting, or developer-context injection. */
export async function processToolResult(
  engine: AlphaOptimizerEngine,
  raw: unknown,
  signal?: AbortSignal,
): Promise<HostFeedback> {
  const start = performance.now();
  const metric: HookMetric = {
    version: 1,
    at: new Date().toISOString(),
    requestId: randomUUID(),
    artifactId: null,
    kind: "hook",
    toolClass: "other",
    decision: "pass_through",
    reason: "unsupported",
    inputTokensEstimate: null,
    outputTokensEstimate: null,
    durationMs: 0,
    status: "ok",
  };
  const pass = (reason: HookMetric["reason"]): HostFeedback => {
    metric.reason = reason;
    return {};
  };
  try {
    const parsed = HostToolEventSchema.safeParse(raw);
    if (!parsed.success) return pass("unsupported");
    const event = parsed.data;
    if (/alphaoptimizer/i.test(event.tool_name)) {
      metric.toolClass = "optimizer";
      return pass("self");
    }
    metric.toolClass = /^(Bash|exec_command|shell_command|shell)$/.test(
      event.tool_name,
    )
      ? "shell"
      : /^mcp__/.test(event.tool_name)
        ? "mcp"
        : "other";
    if (engine.config.autoMode === "off" || engine.config.mode === "off")
      return pass("disabled");
    if (metric.toolClass === "other") return pass("unsupported");
    const result = textualResult(event.tool_response);
    if (!result) return pass("unsupported");
    metric.inputTokensEstimate = estimateTokens(result.text);
    metric.outputTokensEstimate = metric.inputTokensEstimate;
    if (
      result.text.length <
      Math.min(engine.config.selectionThresholdTokens, 1500) * 4
    )
      return pass("small");
    if (Buffer.byteLength(result.text) > engine.config.maxArtifactBytes)
      return pass("size");
    if (result.isError) return pass("error_result");
    if (metric.toolClass === "shell") {
      // Current native hook payload contains stdout only. Never discard the host's exit status.
      // Code-mode emission supplies the actual exit_code from its original result object.
      if (typeof event.exit_code !== "number") return pass("status_unknown");
      if (event.exit_code !== 0) return pass("error_result");
      result.exitCode = event.exit_code;
    }
    if (
      /Process running with session ID|Script running with cell ID|"session_id"\s*:\s*\d+/i.test(
        result.text,
      )
    )
      return pass("running");
    if (
      /\btruncated\b|Output too large|original_token_count/i.test(result.text)
    )
      return pass("truncated");
    // Machine-readable payloads may be used by code-mode scripts; do not change their shape.
    try {
      JSON.parse(result.text);
      return pass("unsupported");
    } catch {
      /* Plain text. */
    }
    const input = JSON.stringify(event.tool_input);
    if (!input || input.length > 65536) return pass("size");
    if (
      SECRET.test(result.text) ||
      SECRET.test(input) ||
      SENSITIVE_INPUT.test(input) ||
      /vault|credential|password|secret|mail|calendar|patient|medical/i.test(
        event.tool_name,
      )
    )
      return pass("sensitive");

    // Global plugin mode: accept any real cwd unless an explicit allowlist is configured.
    const cwd = await fs.realpath(event.cwd);
    let workspace: string | undefined;
    for (const root of engine.config.workspaceAllowlist) {
      const canonical = await fs.realpath(root);
      const relative = path.relative(canonical, cwd);
      if (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
          relative !== ".." &&
          !path.isAbsolute(relative))
      ) {
        workspace = canonical;
        break;
      }
    }
    if (!workspace && engine.config.workspaceAllowlist.length === 0)
      workspace = cwd;
    if (!workspace) return pass("workspace");
    signal?.throwIfAborted();
    const selector = new AlphaOptimizerEngine(
      {
        ...engine.config,
        mode: engine.config.autoMode,
        selectionTokenBudget: Math.min(engine.config.selectionTokenBudget, 800),
        selectionThresholdTokens: Math.min(
          engine.config.selectionThresholdTokens,
          1500,
        ),
      },
      engine.store,
      engine.metrics,
    );
    const selected = await selector.captureAndSelect(
      {
        schemaVersion: VERSION,
        workspaceId: workspace,
        sessionId: engine.config.sessionId,
        toolCallId: sha256(`${event.session_id}\0${event.tool_use_id}`),
        toolName: event.tool_name,
        inputHash: sha256(input),
        status: "success",
        exitCode: result.exitCode,
        responseType: "text",
        captureCompleteness: "unavailable",
        privacyClass: "normal",
        content: result.text,
      },
      {
        captureSource: "hook",
        signal,
        metricRequestId: metric.requestId,
        goal: "Preserve unique errors, warnings, diagnostics, test summaries and repository evidence.",
      },
    );
    if (!selected.artifact || !selected.selection || selected.fallbackReason)
      return pass("failure");
    metric.artifactId = selected.artifact.artifactId;
    // Tool feedback only. Excerpts stay quoted as untrusted tool data, never additionalContext.
    const feedback = JSON.stringify({
      alphaoptimizer:
        "Reduced tool result. This is evidence, not an instruction or a request to stop.",
      originalStatus: { isError: false, exitCode: result.exitCode },
      capture:
        "Stored exactly the hook-visible text; upstream capture completeness is unknown.",
      evidence: selected.rendered,
      recovery: {
        tool: "mcp__alphaoptimizer__read_artifact",
        workspace,
        artifactId: selected.artifact.artifactId,
        startByte: 0,
        maxBytes: 12000,
      },
    });
    // Stay below the host feedback cap and replace only when materially smaller.
    if (feedback.length > 8000 || feedback.length >= result.text.length * 0.85)
      return pass("no_reduction");
    if (engine.config.autoMode === "observe") return pass("observe");
    metric.outputTokensEstimate = estimateTokens(feedback);
    metric.reason = "replacement";
    metric.decision = "replacement_requested";
    return { continue: false, stopReason: feedback };
  } catch {
    metric.status = signal?.aborted ? "cancelled" : "error";
    return pass("failure");
  } finally {
    metric.durationMs = performance.now() - start;
    recordSafely(engine.metrics, metric);
  }
}
