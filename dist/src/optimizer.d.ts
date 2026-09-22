import { AlphaOptimizerConfig } from "./config.js";
import { ArtifactRecord, Selection, ToolObservation } from "./contracts/schemas.js";
import { EvidenceStore } from "./store/evidenceStore.js";
import { MetricSink } from "./telemetry/metrics.js";
export type CaptureAndSelectResult = {
    mode: string;
    artifact: ArtifactRecord | null;
    selection: Selection | null;
    rendered: string;
    fallbackReason: string | null;
};
export declare class AlphaOptimizerEngine {
    readonly config: AlphaOptimizerConfig;
    readonly store: EvidenceStore;
    readonly metrics?: MetricSink | undefined;
    constructor(config: AlphaOptimizerConfig, store?: EvidenceStore, metrics?: MetricSink | undefined);
    captureAndSelect(observationInput: ToolObservation, options?: {
        goal?: string;
        captureSource?: "hook" | "mcp" | "fixture" | "repository";
        signal?: AbortSignal;
        metricRequestId?: string;
    }): Promise<CaptureAndSelectResult>;
    private execute;
}
