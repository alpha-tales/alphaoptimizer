#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { VERSION, ToolObservationSchema } from "./contracts/schemas.js";
import { handleHook, HookEventSchema } from "./hooks/adapter.js";
import { processToolResult, HostToolEventSchema } from "./hooks/automatic.js";
import { AlphaOptimizerEngine } from "./optimizer.js";
import { searchRepository as searchRepo } from "./repository/search.js";
import { sha256 } from "./util/hash.js";
import { assertScopeAllowed } from "./util/workspace.js";
import { BufferedMetrics } from "./telemetry/metrics.js";
import { measureTool } from "./telemetry/tool.js";
const config = loadConfig();
const metrics = config.metricsEnabled
    ? new BufferedMetrics(config.dataDir)
    : undefined;
const engine = new AlphaOptimizerEngine(config, undefined, metrics);
const server = new McpServer({
    name: "alphaoptimizer",
    version: "0.1.0",
});
function textResult(value) {
    return {
        content: [
            {
                type: "text",
                text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
            },
        ],
    };
}
function serverScope(workspace) {
    return assertScopeAllowed({
        workspaceId: workspace,
        sessionId: config.sessionId,
    }, config.workspaceAllowlist);
}
server.registerTool("select_evidence", {
    title: "Select Evidence",
    description: "Capture textual tool output, store it durably, and return deterministic evidence under budget.",
    inputSchema: {
        workspace: z.string(),
        sessionId: z.string().optional(),
        toolCallId: z.string().default(() => crypto.randomUUID()),
        toolName: z.string().default("manual"),
        content: z.string(),
        goal: z.string().optional(),
        status: z.enum(["success", "error", "unknown"]).default("unknown"),
        captureCompleteness: z
            .enum(["complete", "truncated", "streamed_partial", "unavailable"])
            .default("complete"),
        privacyClass: z.enum(["normal", "sensitive", "secret"]).default("normal"),
    },
}, async (input, extra) => measureTool(metrics, "select_evidence", async (requestId) => {
    const parsed = input;
    const result = await engine.captureAndSelect(ToolObservationSchema.parse({
        schemaVersion: VERSION,
        workspaceId: parsed.workspace,
        sessionId: config.sessionId,
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        inputHash: sha256(parsed.goal ?? parsed.toolName),
        status: parsed.status,
        responseType: "text",
        captureCompleteness: parsed.captureCompleteness,
        privacyClass: parsed.privacyClass,
        content: parsed.content,
    }), {
        goal: parsed.goal,
        signal: extra.signal,
        metricRequestId: requestId,
    });
    return textResult({
        artifact: result.artifact,
        sessionId: config.sessionId,
        selection: result.selection,
        selectedText: result.rendered,
        fallbackReason: result.fallbackReason,
    });
}, extra.signal));
server.registerTool("read_artifact", {
    title: "Read Artifact",
    description: "Retrieve a bounded artifact range, or case-insensitive literal match windows. Pass query and the returned cursor to continue search.",
    inputSchema: {
        workspace: z.string(),
        sessionId: z.string().optional(),
        artifactId: z.string(),
        startByte: z.number().int().nonnegative().default(0),
        maxBytes: z.number().int().positive().max(100000).default(12000),
        query: z.string().min(1).max(1000).optional(),
        cursor: z.string().max(2048).optional(),
    },
}, async (input, extra) => measureTool(metrics, "read_artifact", async () => {
    const scope = serverScope(input.workspace);
    if (input.query) {
        return textResult({
            artifact: engine.store.getArtifact(input.artifactId, scope),
            search: engine.store.searchArtifactText(input.artifactId, input.query, input.maxBytes, scope, input.cursor),
        });
    }
    return textResult({
        artifact: engine.store.getArtifact(input.artifactId, scope),
        range: engine.store.readArtifactRange(input.artifactId, input.startByte, input.maxBytes, scope),
    });
}, extra.signal, input.artifactId));
server.registerTool("search_repository", {
    title: "Search Repository",
    description: "Search an allowed workspace and return source-linked excerpts with content hashes.",
    inputSchema: {
        workspace: z.string(),
        query: z.string(),
        limit: z.number().int().positive().max(50).default(10),
        contextLines: z.number().int().nonnegative().max(20).default(3),
    },
}, async (input, extra) => measureTool(metrics, "search_repository", async () => {
    const excerpts = await searchRepo({
        workspace: input.workspace,
        query: input.query,
        allowlist: config.workspaceAllowlist,
        limit: input.limit,
        contextLines: input.contextLines,
        maxFileBytes: config.repositoryMaxFileBytes,
        signal: extra.signal,
    });
    return textResult({ excerpts });
}, extra.signal));
server.registerTool("record_criterion", {
    title: "Record Criterion",
    description: "Record explicit or inferred task criteria without claiming they are verified.",
    inputSchema: {
        workspace: z.string(),
        sessionId: z.string().optional(),
        text: z.string(),
        provenance: z
            .enum(["explicit_user", "project_instruction", "inferred"])
            .default("explicit_user"),
    },
}, async (input) => textResult({
    criterion: engine.store.upsertCriterion({
        ...assertScopeAllowed({
            workspaceId: input.workspace,
            sessionId: config.sessionId,
        }, config.workspaceAllowlist),
        text: input.text,
        provenance: input.provenance,
    }),
}));
server.registerTool("check_completion", {
    title: "Check Completion",
    description: "Return recorded criterion states and evidence gaps.",
    inputSchema: {
        workspace: z.string(),
        sessionId: z.string().optional(),
    },
}, async (input) => {
    const scope = serverScope(input.workspace);
    const criteria = engine.store.listCriteria(scope.workspaceId, scope.sessionId);
    return textResult({
        criteria,
        gaps: criteria.length === 0
            ? [{ status: "unknown", reason: "no criteria recorded" }]
            : criteria.filter((criterion) => criterion.status === "unknown" || criterion.status === "failed"),
    });
});
server.registerTool("handle_hook", {
    title: "Handle Hook",
    description: "Normalize a supported Codex hook event and return an advisory host-specific response.",
    inputSchema: HookEventSchema.shape,
}, async (input) => textResult(await handleHook(engine, { ...input, sessionId: config.sessionId })));
const transport = new StdioServerTransport();
server.registerTool("process_tool_result", {
    title: "Process Tool Result",
    description: "Internal PostToolUse hook. Called automatically by the host; returns pass-through or bounded tool feedback. Never approves or executes tools.",
    inputSchema: HostToolEventSchema.shape,
}, async (input, extra) => {
    const feedback = await processToolResult(engine, input, extra.signal);
    return { ...textResult(feedback), structuredContent: feedback };
});
await server.connect(transport);
const retentionTimer = setInterval(() => {
    try {
        engine.store.cleanupExpired();
    }
    catch {
        process.stderr.write("alphaoptimizer: retention sweep failed\n");
    }
}, 60000);
retentionTimer.unref();
let closing = false;
async function shutdown() {
    if (closing)
        return;
    closing = true;
    clearInterval(retentionTimer);
    await metrics?.close(1000);
    engine.store.close();
    process.exit(0);
}
server.server.onclose = () => {
    void shutdown();
};
process.stdin.once("end", () => {
    void shutdown();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        void shutdown();
    });
}
