import { z } from "zod";
export declare const MetricSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    version: z.ZodLiteral<1>;
    at: z.ZodString;
    requestId: z.ZodString;
    artifactId: z.ZodNullable<z.ZodString>;
    durationMs: z.ZodNumber;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        error: "error";
        ok: "ok";
    }>;
    loggerDropped: z.ZodOptional<z.ZodNumber>;
    loggerWriteFailures: z.ZodOptional<z.ZodNumber>;
    kind: z.ZodLiteral<"hook">;
    toolClass: z.ZodEnum<{
        mcp: "mcp";
        optimizer: "optimizer";
        other: "other";
        shell: "shell";
    }>;
    decision: z.ZodEnum<{
        pass_through: "pass_through";
        replacement_requested: "replacement_requested";
    }>;
    reason: z.ZodEnum<{
        disabled: "disabled";
        error_result: "error_result";
        failure: "failure";
        no_reduction: "no_reduction";
        observe: "observe";
        replacement: "replacement";
        running: "running";
        self: "self";
        sensitive: "sensitive";
        size: "size";
        small: "small";
        status_unknown: "status_unknown";
        truncated: "truncated";
        unsupported: "unsupported";
        workspace: "workspace";
    }>;
    inputTokensEstimate: z.ZodNullable<z.ZodNumber>;
    outputTokensEstimate: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    version: z.ZodLiteral<1>;
    at: z.ZodString;
    requestId: z.ZodString;
    artifactId: z.ZodNullable<z.ZodString>;
    durationMs: z.ZodNumber;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        error: "error";
        ok: "ok";
    }>;
    loggerDropped: z.ZodOptional<z.ZodNumber>;
    loggerWriteFailures: z.ZodOptional<z.ZodNumber>;
    kind: z.ZodLiteral<"selection">;
    inputTokensEstimate: z.ZodNumber;
    outputTokensEstimate: z.ZodNullable<z.ZodNumber>;
    selectedChunks: z.ZodNumber;
    omittedChunks: z.ZodNumber;
    mode: z.ZodEnum<{
        filter: "filter";
        observe: "observe";
        off: "off";
    }>;
    source: z.ZodEnum<{
        fixture: "fixture";
        hook: "hook";
        mcp: "mcp";
        repository: "repository";
    }>;
    fallback: z.ZodEnum<{
        capture: "capture";
        disabled: "disabled";
        durability: "durability";
        none: "none";
        overflow: "overflow";
        privacy: "privacy";
        size: "size";
    }>;
    provider: z.ZodEnum<{
        fallback: "fallback";
        not_run: "not_run";
        skipped: "skipped";
        success: "success";
    }>;
    providerAttempted: z.ZodBoolean;
    providerDurationMs: z.ZodNumber;
    providerInputTokens: z.ZodNullable<z.ZodNumber>;
    providerOutputTokens: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    version: z.ZodLiteral<1>;
    at: z.ZodString;
    requestId: z.ZodString;
    artifactId: z.ZodNullable<z.ZodString>;
    durationMs: z.ZodNumber;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        error: "error";
        ok: "ok";
    }>;
    loggerDropped: z.ZodOptional<z.ZodNumber>;
    loggerWriteFailures: z.ZodOptional<z.ZodNumber>;
    kind: z.ZodLiteral<"tool">;
    operation: z.ZodEnum<{
        read_artifact: "read_artifact";
        search_repository: "search_repository";
        select_evidence: "select_evidence";
    }>;
    responseTokensEstimate: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>], "kind">;
export type Metric = z.infer<typeof MetricSchema>;
export interface MetricSink {
    record(event: Metric): void;
}
export declare function recordSafely(sink: MetricSink | undefined, event: Metric): void;
export declare const METRIC_FILE: RegExp;
type Options = {
    maxQueue?: number;
    batchSize?: number;
    flushMs?: number;
    maxFileBytes?: number;
    writeBatch?: (batch: string) => Promise<void>;
};
export declare class BufferedMetrics implements MetricSink {
    private readonly options;
    readonly directory: string;
    readonly filename: string;
    private queue;
    private timer?;
    private pending?;
    private closed;
    private size;
    private readonly maxQueue;
    private readonly batchSize;
    private readonly flushMs;
    private readonly maxFileBytes;
    readonly health: {
        accepted: number;
        written: number;
        dropped: number;
        writeFailures: number;
    };
    constructor(dataDir: string, options?: Options);
    record(event: Metric): void;
    private schedule;
    flush(): Promise<void>;
    private drain;
    private write;
    private prune;
    close(timeoutMs?: number): Promise<void>;
}
export {};
