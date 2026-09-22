import { randomUUID } from "node:crypto";
import { JevProvider } from "./providers/jev.js";
import { ToolObservationSchema, } from "./contracts/schemas.js";
import { chunkText } from "./parsers/text.js";
import { EvidenceStore } from "./store/evidenceStore.js";
import { estimateTokens, sha256, shortId } from "./util/hash.js";
import { selectDeterministicAsync, renderSelection, } from "./selection/deterministic.js";
import { assertScopeAllowed } from "./util/workspace.js";
import { recordSafely } from "./telemetry/metrics.js";
export class AlphaOptimizerEngine {
    config;
    store;
    metrics;
    constructor(config, store = new EvidenceStore(config.dataDir, config), metrics) {
        this.config = config;
        this.store = store;
        this.metrics = metrics;
    }
    async captureAndSelect(observationInput, options = {}) {
        const leaseId = randomUUID();
        const start = performance.now();
        const metric = {
            version: 1,
            at: new Date().toISOString(),
            requestId: options.metricRequestId ?? leaseId,
            artifactId: null,
            kind: "selection",
            status: "error",
            durationMs: 0,
            inputTokensEstimate: typeof observationInput.content === "string"
                ? estimateTokens(observationInput.content)
                : 0,
            outputTokensEstimate: null,
            selectedChunks: 0,
            omittedChunks: 0,
            mode: this.config.mode,
            source: options.captureSource ?? "mcp",
            fallback: "none",
            provider: "not_run",
            providerAttempted: false,
            providerDurationMs: 0,
            providerInputTokens: null,
            providerOutputTokens: null,
        };
        let result;
        try {
            options.signal?.throwIfAborted();
            result = await this.execute(observationInput, {
                ...options,
                leaseId,
                metric,
            });
            options.signal?.throwIfAborted();
            if (result.artifact &&
                !this.store.retainResponseLease(leaseId, result.artifact.artifactId)) {
                result = {
                    mode: this.config.mode,
                    artifact: null,
                    selection: null,
                    rendered: observationInput.content,
                    fallbackReason: "evidence no longer durable; original content preserved",
                };
            }
            metric.status = "ok";
            return result;
        }
        catch (error) {
            metric.status = options.signal?.aborted ? "cancelled" : "error";
            throw error;
        }
        finally {
            metric.durationMs = performance.now() - start;
            if (result && metric.status === "ok") {
                metric.artifactId = result.artifact?.artifactId ?? null;
                metric.outputTokensEstimate = estimateTokens(result.rendered);
                metric.selectedChunks = result.selection?.selectedChunkIds.length ?? 0;
                metric.omittedChunks = result.selection?.omittedChunkCount ?? 0;
                metric.fallback =
                    result.fallbackReason === "optimizer disabled"
                        ? "disabled"
                        : result.fallbackReason === "secret observations are not captured"
                            ? "privacy"
                            : result.fallbackReason ===
                                "artifact exceeds configured maxArtifactBytes"
                                ? "size"
                                : result.fallbackReason ===
                                    "capture failed; original content preserved"
                                    ? "capture"
                                    : result.fallbackReason ===
                                        "evidence no longer durable; original content preserved"
                                        ? "durability"
                                        : result.fallbackReason
                                            ? "overflow"
                                            : "none";
            }
            recordSafely(this.metrics, metric);
        }
    }
    async execute(observationInput, options = {}) {
        const parsed = ToolObservationSchema.parse(observationInput);
        const scope = assertScopeAllowed({
            workspaceId: parsed.workspaceId,
            sessionId: parsed.sessionId,
        }, this.config.workspaceAllowlist);
        const observation = {
            ...parsed,
            workspaceId: scope.workspaceId,
            sessionId: scope.sessionId,
        };
        if (this.config.mode === "off") {
            return {
                mode: "off",
                artifact: null,
                selection: null,
                rendered: observation.content,
                fallbackReason: "optimizer disabled",
            };
        }
        if (observation.privacyClass === "secret") {
            return {
                mode: this.config.mode,
                artifact: null,
                selection: null,
                rendered: observation.content,
                fallbackReason: "secret observations are not captured",
            };
        }
        if (Buffer.byteLength(observation.content) > this.config.maxArtifactBytes) {
            return {
                mode: this.config.mode,
                artifact: null,
                selection: null,
                rendered: observation.content,
                fallbackReason: "artifact exceeds configured maxArtifactBytes",
            };
        }
        const estimatedTokens = estimateTokens(observation.content);
        const artifactId = shortId(observation.workspaceId, observation.sessionId, observation.toolCallId, sha256(observation.content));
        const chunks = chunkText(artifactId, observation.content);
        if (estimatedTokens < this.config.selectionThresholdTokens ||
            chunks.length === 0) {
            return {
                mode: this.config.mode,
                artifact: null,
                selection: null,
                rendered: observation.content,
                fallbackReason: "output below selection threshold; original content preserved",
            };
        }
        if (!this.config.jevEnabled ||
            !this.config.jevApiKey ||
            observation.privacyClass !== "normal") {
            return {
                mode: this.config.mode,
                artifact: null,
                selection: null,
                rendered: observation.content,
                fallbackReason: "jev unavailable; original content preserved",
            };
        }
        let relevantIds;
        const providerStart = performance.now();
        try {
            const provider = new JevProvider({
                enabled: true,
                endpoint: this.config.jevEndpoint,
                apiKey: this.config.jevApiKey,
            });
            const candidates = chunks
                .filter((chunk) => !chunk.pinnedEvidence)
                .slice(0, 40)
                .map((chunk) => ({ id: chunk.chunkId, text: chunk.text }));
            if (!candidates.length) {
                if (options.metric)
                    options.metric.provider = "skipped";
                return {
                    mode: this.config.mode,
                    artifact: null,
                    selection: null,
                    rendered: observation.content,
                    fallbackReason: "jev unavailable; original content preserved",
                };
            }
            const decisions = await provider.classify({
                goal: options.goal ?? "",
                candidates,
                privacyClass: observation.privacyClass,
                signal: options.signal,
                onRequest: () => {
                    if (options.metric)
                        options.metric.providerAttempted = true;
                },
                onUsage: (usage) => {
                    if (options.metric) {
                        options.metric.providerInputTokens = usage.input_tokens;
                        options.metric.providerOutputTokens = usage.output_tokens;
                    }
                },
            });
            relevantIds = new Set(decisions
                .filter((decision) => decision.verdict === "relevant")
                .map((decision) => decision.id));
            if (options.metric)
                options.metric.provider = "success";
        }
        catch {
            if (options.metric)
                options.metric.provider = "fallback";
            return {
                mode: this.config.mode,
                artifact: null,
                selection: null,
                rendered: observation.content,
                fallbackReason: "jev unavailable; original content preserved",
            };
        }
        finally {
            if (options.metric)
                options.metric.providerDurationMs = performance.now() - providerStart;
        }
        const expiresAt = new Date(Date.now() + this.config.retentionDays * 24 * 60 * 60 * 1000).toISOString();
        let artifact;
        try {
            artifact = this.store.captureObservation(observation, {
                captureSource: options.captureSource ?? "mcp",
                expiresAt,
                leaseId: options.leaseId,
            });
        }
        catch (error) {
            process.stderr.write(`alphaoptimizer: capture fallback: ${error.message}\n`);
            return {
                mode: this.config.mode,
                artifact: null,
                selection: null,
                rendered: observation.content,
                fallbackReason: "capture failed; original content preserved",
            };
        }
        options.signal?.throwIfAborted();
        const selection = await selectDeterministicAsync(chunks, {
            tokenBudget: this.config.selectionTokenBudget,
            goal: options.goal,
            relevantIds,
            providerStatus: "jev-used",
            signal: options.signal,
        });
        return {
            mode: this.config.mode,
            artifact,
            selection,
            rendered: renderSelection(chunks, selection),
            fallbackReason: selection.fallbackMode,
        };
    }
}
