import fs from "node:fs/promises";
import path from "node:path";
import { METRIC_FILE, Metric, MetricSchema } from "./metrics.js";

export async function readMetrics(directory: string) {
  let names: string[];
  try {
    names = (await fs.readdir(directory)).filter((name) =>
      METRIC_FILE.test(name),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { events: [] as Metric[], skipped: 0, dropCounters: 0 };
    throw error;
  }
  const candidates: Array<{ name: string; mtime: number }> = [];
  let skipped = 0;
  for (const name of names) {
    try {
      const stat = await fs.lstat(path.join(directory, name));
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        skipped++;
        continue;
      }
      candidates.push({ name, mtime: stat.mtimeMs });
    } catch {
      skipped++;
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const events: Metric[] = [];
  const drops = new Map<string, number>();
  skipped += Math.max(0, candidates.length - 32);
  for (const { name } of candidates.slice(0, 32)) {
    try {
      const content = await fs.readFile(path.join(directory, name), "utf8");
      for (const line of content.split("\n")) {
        if (!line) continue;
        try {
          const event = MetricSchema.parse(JSON.parse(line));
          events.push(event);
          const stream = name.replace(".previous", "");
          drops.set(
            stream,
            Math.max(drops.get(stream) ?? 0, event.loggerDropped ?? 0),
          );
        } catch {
          skipped++;
        }
      }
    } catch {
      skipped++;
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  return {
    events,
    skipped,
    dropCounters: [...drops.values()].reduce((sum, n) => sum + n, 0),
  };
}

function latency(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    meanMs: values.length
      ? values.reduce((sum, v) => sum + v, 0) / values.length
      : null,
    p95Ms: values.length ? sorted[Math.ceil(values.length * 0.95) - 1] : null,
  };
}
export function summarizeMetrics(events: Metric[]) {
  const selections = events.filter((e) => e.kind === "selection");
  const tools = events.filter((e) => e.kind === "tool");
  const hooks = events.filter((e) => e.kind === "hook");
  const groups = new Map<string, typeof selections>();
  for (const event of selections) {
    const key = `${event.source}/${event.mode}/${event.provider}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return {
    measurement:
      "Retained local metrics only. Payload estimates use ceil(UTF-16 characters / 4); these are NOT measured Codex token or cost savings.",
    since: events[0]?.at ?? null,
    until: events.at(-1)?.at ?? null,
    selectionRequests: selections.length,
    automaticHooks: {
      inspected: hooks.length,
      replacementRequests: hooks.filter(
        (e) => e.decision === "replacement_requested",
      ).length,
      passThrough: hooks.filter((e) => e.decision === "pass_through").length,
      errors: hooks.filter((e) => e.status !== "ok").length,
      requestedPayloadReductionTokensEstimate: hooks
        .filter((e) => e.decision === "replacement_requested")
        .reduce(
          (total, e) =>
            total +
            (e.inputTokensEstimate ?? 0) -
            (e.outputTokensEstimate ?? 0),
          0,
        ),
      reasons: Object.fromEntries(
        [...new Set(hooks.map((e) => e.reason))].map((reason) => [
          reason,
          hooks.filter((e) => e.reason === reason).length,
        ]),
      ),
      deliveryNote:
        "Hook decisions, not host delivery receipts. Host timeouts or other hooks can leave the original visible.",
      ...latency(hooks.map((e) => e.durationMs)),
    },
    failedSelections: selections.filter((e) => e.status === "error").length,
    failedToolCalls: tools.filter((e) => e.status === "error").length,
    cancelledSelections: selections.filter((e) => e.status === "cancelled")
      .length,
    cancelledToolCalls: tools.filter((e) => e.status === "cancelled").length,
    eventCountsNote:
      "Selection and tool records describe different stages of a request; do not add them as independent requests.",
    groups: [...groups.entries()].map(([group, entries]) => {
      const successful = entries.filter(
        (e) => e.status === "ok" && e.outputTokensEstimate !== null,
      );
      const input = successful.reduce((n, e) => n + e.inputTokensEstimate, 0);
      const output = successful.reduce(
        (n, e) => n + e.outputTokensEstimate!,
        0,
      );
      return {
        group,
        requests: entries.length,
        inputTokensEstimate: input,
        outputTokensEstimate: output,
        payloadReductionTokensEstimate: input - output,
        payloadReductionPercentEstimate: input
          ? (100 * (input - output)) / input
          : null,
        fallbacks: entries.filter(
          (e) => e.fallback !== "none" || e.provider === "fallback",
        ).length,
        ...latency(entries.map((e) => e.durationMs)),
      };
    }),
    provider: {
      attemptedRequests: selections.filter((e) => e.providerAttempted).length,
      successfulClassifications: selections.filter(
        (e) => e.provider === "success",
      ).length,
      requestsWithoutUsage: selections.filter(
        (e) => e.providerAttempted && e.providerInputTokens === null,
      ).length,
      knownInputTokens: selections.reduce(
        (n, e) => n + (e.providerInputTokens ?? 0),
        0,
      ),
      knownOutputTokens: selections.reduce(
        (n, e) => n + (e.providerOutputTokens ?? 0),
        0,
      ),
      ...latency(
        selections
          .filter((e) => e.providerAttempted)
          .map((e) => e.providerDurationMs),
      ),
    },
    toolResponses: [
      "select_evidence",
      "read_artifact",
      "search_repository",
    ].map((operation) => {
      const records = tools.filter((e) => e.operation === operation);
      return {
        operation,
        calls: records.length,
        responseTokensEstimate: records.reduce(
          (n, e) => n + (e.responseTokensEstimate ?? 0),
          0,
        ),
        ...latency(records.map((e) => e.durationMs)),
      };
    }),
  };
}
