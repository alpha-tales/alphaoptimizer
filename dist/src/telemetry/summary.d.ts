import { Metric } from "./metrics.js";
export declare function readMetrics(directory: string): Promise<{
    events: Metric[];
    skipped: number;
    dropCounters: number;
}>;
export declare function summarizeMetrics(events: Metric[]): {
    measurement: string;
    since: string;
    until: string | null;
    selectionRequests: number;
    automaticHooks: {
        meanMs: number | null;
        p95Ms: number | null;
        inspected: number;
        replacementRequests: number;
        passThrough: number;
        errors: number;
        requestedPayloadReductionTokensEstimate: number;
        reasons: {
            [k: string]: number;
        };
        deliveryNote: string;
    };
    failedSelections: number;
    failedToolCalls: number;
    cancelledSelections: number;
    cancelledToolCalls: number;
    eventCountsNote: string;
    groups: {
        meanMs: number | null;
        p95Ms: number | null;
        group: string;
        requests: number;
        inputTokensEstimate: number;
        outputTokensEstimate: number;
        payloadReductionTokensEstimate: number;
        payloadReductionPercentEstimate: number | null;
        fallbacks: number;
    }[];
    provider: {
        meanMs: number | null;
        p95Ms: number | null;
        attemptedRequests: number;
        successfulClassifications: number;
        requestsWithoutUsage: number;
        knownInputTokens: number;
        knownOutputTokens: number;
    };
    toolResponses: {
        meanMs: number | null;
        p95Ms: number | null;
        operation: string;
        calls: number;
        responseTokensEstimate: number;
    }[];
};
