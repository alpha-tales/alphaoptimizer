import { randomUUID } from "node:crypto";
import { recordSafely } from "./metrics.js";
export async function measureTool(sink, operation, run, signal, artifactId) {
    const requestId = randomUUID();
    if (!sink)
        return run(requestId);
    const start = performance.now();
    let result;
    try {
        result = await run(requestId);
        return result;
    }
    finally {
        recordSafely(sink, {
            version: 1,
            at: new Date().toISOString(),
            requestId,
            kind: "tool",
            artifactId: artifactId && /^[a-f0-9]{24}$/.test(artifactId) ? artifactId : null,
            operation,
            durationMs: performance.now() - start,
            status: result && !result.isError
                ? "ok"
                : signal?.aborted
                    ? "cancelled"
                    : "error",
            responseTokensEstimate: result
                ? Math.ceil(result.content.reduce((n, c) => n + (c.text?.length ?? 0), 0) / 4)
                : null,
        });
    }
}
