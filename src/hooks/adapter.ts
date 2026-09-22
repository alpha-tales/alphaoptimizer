import { z } from "zod";
import { AlphaOptimizerEngine } from "../optimizer.js";
import { sha256 } from "../util/hash.js";
import { VERSION } from "../contracts/schemas.js";

export const HookEventSchema = z.object({
  event: z.string(),
  workspace: z.string(),
  sessionId: z.string().default("unknown-session"),
  toolCallId: z.string().default("unknown-tool-call"),
  toolName: z.string().default("unknown-tool"),
  input: z.unknown().optional(),
  output: z.string().default(""),
  status: z.enum(["success", "error", "unknown"]).default("unknown"),
  exitCode: z.number().int().nullable().optional(),
  captureCompleteness: z
    .enum(["complete", "truncated", "streamed_partial", "unavailable"])
    .default("unavailable"),
  privacyClass: z.enum(["normal", "sensitive", "secret"]).default("sensitive"),
});

export async function handleHook(
  engine: AlphaOptimizerEngine,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const event = HookEventSchema.parse(raw);
  if (event.event !== "PostToolUse") {
    return { action: "pass_through", reason: "unsupported hook event" };
  }

  const result = await engine.captureAndSelect(
    {
      schemaVersion: VERSION,
      workspaceId: event.workspace,
      sessionId: event.sessionId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      inputHash: sha256(JSON.stringify(event.input ?? {})),
      status: event.status,
      exitCode: event.exitCode,
      responseType: "text",
      captureCompleteness: event.captureCompleteness,
      privacyClass: event.privacyClass,
      content: event.output,
    },
    {
      goal:
        typeof event.input === "string"
          ? event.input
          : JSON.stringify(event.input ?? {}),
      captureSource: "hook",
    },
  );

  return {
    schemaVersion: "alphaoptimizer.hook.response.v1",
    action: "pass_through",
    artifactId: result.artifact?.artifactId ?? null,
    replacementText: null,
    fallbackReason: result.fallbackReason,
    limitations: [
      "Transparent replacement is unsupported by the current host contract; use select_evidence for optimized output.",
    ],
  };
}
