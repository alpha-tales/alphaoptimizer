import { z } from "zod";
export declare const VERSION = "alphaoptimizer.contracts.v1";
export declare const ModeSchema: z.ZodEnum<{
    filter: "filter";
    observe: "observe";
    off: "off";
}>;
export type Mode = z.infer<typeof ModeSchema>;
export declare const CaptureCompletenessSchema: z.ZodEnum<{
    complete: "complete";
    streamed_partial: "streamed_partial";
    truncated: "truncated";
    unavailable: "unavailable";
}>;
export type CaptureCompleteness = z.infer<typeof CaptureCompletenessSchema>;
export declare const PrivacyClassSchema: z.ZodEnum<{
    normal: "normal";
    secret: "secret";
    sensitive: "sensitive";
}>;
export type PrivacyClass = z.infer<typeof PrivacyClassSchema>;
export declare const ToolObservationSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"alphaoptimizer.contracts.v1">;
    workspaceId: z.ZodString;
    sessionId: z.ZodString;
    turnId: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodString>;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    inputHash: z.ZodString;
    status: z.ZodEnum<{
        error: "error";
        success: "success";
        unknown: "unknown";
    }>;
    exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    responseType: z.ZodEnum<{
        binary: "binary";
        json: "json";
        mixed: "mixed";
        text: "text";
        unknown: "unknown";
    }>;
    captureCompleteness: z.ZodEnum<{
        complete: "complete";
        streamed_partial: "streamed_partial";
        truncated: "truncated";
        unavailable: "unavailable";
    }>;
    privacyClass: z.ZodDefault<z.ZodEnum<{
        normal: "normal";
        secret: "secret";
        sensitive: "sensitive";
    }>>;
    startedAt: z.ZodOptional<z.ZodString>;
    completedAt: z.ZodOptional<z.ZodString>;
    content: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type ToolObservation = z.infer<typeof ToolObservationSchema>;
export declare const ArtifactRecordSchema: z.ZodObject<{
    artifactId: z.ZodString;
    workspaceId: z.ZodString;
    sessionId: z.ZodString;
    toolCallId: z.ZodString;
    contentHash: z.ZodString;
    byteLength: z.ZodNumber;
    encoding: z.ZodLiteral<"utf8">;
    captureSource: z.ZodEnum<{
        fixture: "fixture";
        hook: "hook";
        mcp: "mcp";
        repository: "repository";
    }>;
    captureCompleteness: z.ZodEnum<{
        complete: "complete";
        streamed_partial: "streamed_partial";
        truncated: "truncated";
        unavailable: "unavailable";
    }>;
    privacyClass: z.ZodEnum<{
        normal: "normal";
        secret: "secret";
        sensitive: "sensitive";
    }>;
    truncationFlag: z.ZodBoolean;
    createdAt: z.ZodString;
    expiresAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;
export declare const ChunkSchema: z.ZodObject<{
    chunkId: z.ZodString;
    artifactId: z.ZodString;
    startByte: z.ZodNumber;
    endByte: z.ZodNumber;
    startLine: z.ZodNumber;
    endLine: z.ZodNumber;
    parserKind: z.ZodString;
    sourcePath: z.ZodNullable<z.ZodString>;
    sourceHash: z.ZodNullable<z.ZodString>;
    pinnedEvidence: z.ZodBoolean;
    text: z.ZodString;
}, z.core.$strip>;
export type Chunk = z.infer<typeof ChunkSchema>;
export declare const CriterionStatusSchema: z.ZodEnum<{
    failed: "failed";
    not_applicable: "not_applicable";
    supported: "supported";
    unknown: "unknown";
}>;
export type CriterionStatus = z.infer<typeof CriterionStatusSchema>;
export declare const CriterionSchema: z.ZodObject<{
    criterionId: z.ZodString;
    workspaceId: z.ZodString;
    sessionId: z.ZodString;
    text: z.ZodString;
    provenance: z.ZodEnum<{
        explicit_user: "explicit_user";
        inferred: "inferred";
        project_instruction: "project_instruction";
    }>;
    status: z.ZodEnum<{
        failed: "failed";
        not_applicable: "not_applicable";
        supported: "supported";
        unknown: "unknown";
    }>;
    evidenceRefs: z.ZodArray<z.ZodString>;
    observedRevision: z.ZodNullable<z.ZodString>;
    unresolvedQuestion: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type Criterion = z.infer<typeof CriterionSchema>;
export declare const SelectionSchema: z.ZodObject<{
    artifactId: z.ZodString;
    mode: z.ZodEnum<{
        deterministic: "deterministic";
        deterministic_with_provider: "deterministic_with_provider";
        passthrough: "passthrough";
    }>;
    selectedChunkIds: z.ZodArray<z.ZodString>;
    omittedChunkCount: z.ZodNumber;
    reasonCodes: z.ZodArray<z.ZodString>;
    estimatedTokens: z.ZodNumber;
    expansionCursor: z.ZodNullable<z.ZodString>;
    fallbackMode: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type Selection = z.infer<typeof SelectionSchema>;
export declare const RepositoryExcerptSchema: z.ZodObject<{
    path: z.ZodString;
    startLine: z.ZodNumber;
    endLine: z.ZodNumber;
    contentHash: z.ZodString;
    excerpt: z.ZodString;
    reason: z.ZodString;
}, z.core.$strip>;
export type RepositoryExcerpt = z.infer<typeof RepositoryExcerptSchema>;
