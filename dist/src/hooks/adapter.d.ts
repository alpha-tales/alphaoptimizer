import { z } from "zod";
import { AlphaOptimizerEngine } from "../optimizer.js";
export declare const HookEventSchema: z.ZodObject<{
    event: z.ZodString;
    workspace: z.ZodString;
    sessionId: z.ZodDefault<z.ZodString>;
    toolCallId: z.ZodDefault<z.ZodString>;
    toolName: z.ZodDefault<z.ZodString>;
    input: z.ZodOptional<z.ZodUnknown>;
    output: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        error: "error";
        success: "success";
        unknown: "unknown";
    }>>;
    exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    captureCompleteness: z.ZodDefault<z.ZodEnum<{
        complete: "complete";
        streamed_partial: "streamed_partial";
        truncated: "truncated";
        unavailable: "unavailable";
    }>>;
    privacyClass: z.ZodDefault<z.ZodEnum<{
        normal: "normal";
        secret: "secret";
        sensitive: "sensitive";
    }>>;
}, z.core.$strip>;
export declare function handleHook(engine: AlphaOptimizerEngine, raw: unknown): Promise<Record<string, unknown>>;
