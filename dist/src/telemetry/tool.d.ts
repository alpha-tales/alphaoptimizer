import { MetricSink } from "./metrics.js";
export declare function measureTool<T extends {
    content: Array<{
        type: string;
        text?: string;
    }>;
    isError?: boolean;
}>(sink: MetricSink | undefined, operation: "select_evidence" | "read_artifact" | "search_repository", run: (requestId: string) => Promise<T>, signal?: AbortSignal, artifactId?: string): Promise<T>;
