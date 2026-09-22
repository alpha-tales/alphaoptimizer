import { z } from "zod";
import { AlphaOptimizerEngine } from "../optimizer.js";
export declare const HostToolEventSchema: z.ZodObject<{
    hook_event_name: z.ZodLiteral<"PostToolUse">;
    cwd: z.ZodString;
    session_id: z.ZodString;
    tool_use_id: z.ZodString;
    tool_name: z.ZodString;
    tool_input: z.ZodUnknown;
    tool_response: z.ZodUnknown;
    exit_code: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>;
type HostFeedback = {
    continue?: false;
    stopReason?: string;
};
/** No permission decisions, retries, command rewriting, or developer-context injection. */
export declare function processToolResult(engine: AlphaOptimizerEngine, raw: unknown, signal?: AbortSignal): Promise<HostFeedback>;
export {};
