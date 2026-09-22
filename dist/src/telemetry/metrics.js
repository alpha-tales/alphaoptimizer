import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensurePrivateDirectory } from "../store/privateDirectory.js";
const Count = z.number().int().nonnegative().safe();
const Duration = z.number().finite().nonnegative();
const Common = z.object({
    version: z.literal(1),
    at: z.string().datetime(),
    requestId: z.string().uuid(),
    artifactId: z
        .string()
        .regex(/^[a-f0-9]{24}$/)
        .nullable(),
    durationMs: Duration,
    status: z.enum(["ok", "error", "cancelled"]),
    loggerDropped: Count.optional(),
    loggerWriteFailures: Count.optional(),
});
// Explicit projection at the logging boundary: never serialize arbitrary tool inputs/errors.
export const MetricSchema = z.discriminatedUnion("kind", [
    Common.extend({
        kind: z.literal("hook"),
        toolClass: z.enum(["shell", "mcp", "other", "optimizer"]),
        decision: z.enum(["pass_through", "replacement_requested"]),
        reason: z.enum([
            "disabled",
            "self",
            "unsupported",
            "small",
            "sensitive",
            "running",
            "truncated",
            "error_result",
            "status_unknown",
            "workspace",
            "size",
            "no_reduction",
            "observe",
            "replacement",
            "failure",
        ]),
        inputTokensEstimate: Count.nullable(),
        outputTokensEstimate: Count.nullable(),
    }),
    Common.extend({
        kind: z.literal("selection"),
        inputTokensEstimate: Count,
        outputTokensEstimate: Count.nullable(),
        selectedChunks: Count,
        omittedChunks: Count,
        mode: z.enum(["off", "observe", "filter"]),
        source: z.enum(["hook", "mcp", "fixture", "repository"]),
        fallback: z.enum([
            "none",
            "disabled",
            "privacy",
            "size",
            "capture",
            "overflow",
            "durability",
        ]),
        provider: z.enum(["not_run", "skipped", "success", "fallback"]),
        providerAttempted: z.boolean(),
        providerDurationMs: Duration,
        providerInputTokens: Count.nullable(),
        providerOutputTokens: Count.nullable(),
    }),
    Common.extend({
        kind: z.literal("tool"),
        operation: z.enum([
            "select_evidence",
            "read_artifact",
            "search_repository",
        ]),
        responseTokensEstimate: Count.nullable(),
    }),
]);
export function recordSafely(sink, event) {
    try {
        sink?.record(event);
    }
    catch {
        /* Telemetry cannot fail a request. */
    }
}
export const METRIC_FILE = /^metrics-[a-f0-9-]{36}(?:\.previous)?\.jsonl$/;
export class BufferedMetrics {
    options;
    directory;
    filename;
    queue = [];
    timer;
    pending;
    closed = false;
    size = 0;
    directoryReady = false;
    maxQueue;
    batchSize;
    flushMs;
    maxFileBytes;
    health = { accepted: 0, written: 0, dropped: 0, writeFailures: 0 };
    constructor(dataDir, options = {}) {
        this.options = options;
        this.directory = path.join(dataDir, "metrics");
        this.filename = path.join(this.directory, `metrics-${randomUUID()}.jsonl`);
        this.maxQueue = options.maxQueue ?? 256;
        this.batchSize = options.batchSize ?? 32;
        this.flushMs = options.flushMs ?? 1000;
        this.maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
        for (const value of [
            this.maxQueue,
            this.batchSize,
            this.flushMs,
            this.maxFileBytes,
        ]) {
            if (!Number.isSafeInteger(value) || value <= 0)
                throw new Error("Invalid metrics limits");
        }
    }
    record(event) {
        if (this.closed || this.queue.length >= this.maxQueue) {
            this.health.dropped++;
            return;
        }
        const parsed = MetricSchema.safeParse(event);
        if (!parsed.success) {
            this.health.dropped++;
            return;
        }
        const line = JSON.stringify({
            ...parsed.data,
            loggerDropped: this.health.dropped,
            loggerWriteFailures: this.health.writeFailures,
        }) + "\n";
        if (Buffer.byteLength(line) > Math.min(2048, this.maxFileBytes)) {
            this.health.dropped++;
            return;
        }
        this.queue.push(line);
        this.health.accepted++;
        this.schedule();
    }
    schedule() {
        if (this.timer || this.pending || this.closed || !this.queue.length)
            return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
        }, this.flushMs);
        this.timer.unref();
    }
    async flush() {
        if (this.pending)
            return this.pending;
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = undefined;
        if (!this.queue.length)
            return;
        this.pending = this.drain();
        try {
            await this.pending;
        }
        finally {
            this.pending = undefined;
            this.schedule();
        }
    }
    async drain() {
        // Snapshot bounds each flush even if new requests continue arriving.
        let remaining = this.queue.length;
        while (remaining > 0) {
            const batch = [];
            let bytes = 0;
            while (batch.length < Math.min(this.batchSize, remaining) &&
                this.queue.length) {
                const lineBytes = Buffer.byteLength(this.queue[0]);
                if (bytes + lineBytes > this.maxFileBytes)
                    break;
                batch.push(this.queue.shift());
                bytes += lineBytes;
            }
            remaining -= batch.length;
            try {
                await (this.options.writeBatch?.(batch.join("")) ??
                    this.write(batch.join("")));
                this.health.written += batch.length;
            }
            catch {
                this.health.writeFailures++;
                this.health.dropped += batch.length;
                // No error strings (which can contain paths or credentials), no retries on the request path.
                if (this.health.writeFailures === 1)
                    process.stderr.write("alphaoptimizer: metrics write failed; some metrics were dropped\n");
            }
        }
    }
    async write(batch) {
        if (!this.directoryReady) {
            ensurePrivateDirectory(this.directory);
            this.directoryReady = true;
        }
        const bytes = Buffer.byteLength(batch);
        if (this.size + bytes > this.maxFileBytes) {
            const previous = this.filename.replace(/\.jsonl$/, ".previous.jsonl");
            try {
                await fs.rename(this.filename, previous);
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
            }
            this.size = 0;
        }
        const file = await fs.open(this.filename, constants.O_APPEND |
            constants.O_CREAT |
            constants.O_WRONLY |
            constants.O_NOFOLLOW, 0o600);
        try {
            await file.writeFile(batch);
        }
        finally {
            await file.close();
        }
        this.size += bytes;
        await this.prune();
    }
    async prune() {
        // Best-effort shared retention: seven days, 32 files, 16 MiB. Each process owns unique files.
        const entries = await fs.readdir(this.directory);
        const files = [];
        for (const name of entries.filter((entry) => METRIC_FILE.test(entry))) {
            try {
                const stat = await fs.lstat(path.join(this.directory, name));
                if (stat.isFile())
                    files.push({ name, size: stat.size, mtime: stat.mtimeMs });
            }
            catch {
                /* Another process may prune concurrently. */
            }
        }
        files.sort((a, b) => b.mtime - a.mtime);
        let total = 0;
        for (let i = 0; i < files.length; i++) {
            total += files[i].size;
            if (i >= 32 ||
                total > 16 * 1024 * 1024 ||
                files[i].mtime < Date.now() - 7 * 86400000)
                await fs.rm(path.join(this.directory, files[i].name), { force: true });
        }
    }
    async close(timeoutMs = 1000) {
        this.closed = true;
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = undefined;
        let timer;
        try {
            await Promise.race([
                (async () => {
                    await this.flush();
                    if (this.queue.length)
                        await this.flush();
                })(),
                new Promise((resolve) => {
                    timer = setTimeout(resolve, timeoutMs);
                }),
            ]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
}
