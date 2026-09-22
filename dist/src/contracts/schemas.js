import { z } from "zod";
export const VERSION = "alphaoptimizer.contracts.v1";
export const ModeSchema = z.enum(["off", "observe", "filter"]);
export const CaptureCompletenessSchema = z.enum([
    "complete",
    "truncated",
    "streamed_partial",
    "unavailable"
]);
export const PrivacyClassSchema = z.enum(["normal", "sensitive", "secret"]);
export const ToolObservationSchema = z.object({
    schemaVersion: z.literal(VERSION),
    workspaceId: z.string().min(1),
    sessionId: z.string().min(1),
    turnId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    inputHash: z.string().min(16),
    status: z.enum(["success", "error", "unknown"]),
    exitCode: z.number().int().nullable().optional(),
    responseType: z.enum(["text", "json", "mixed", "binary", "unknown"]),
    captureCompleteness: CaptureCompletenessSchema,
    privacyClass: PrivacyClassSchema.default("normal"),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    content: z.string().default("")
});
export const ArtifactRecordSchema = z.object({
    artifactId: z.string(),
    workspaceId: z.string(),
    sessionId: z.string(),
    toolCallId: z.string(),
    contentHash: z.string(),
    byteLength: z.number().int().nonnegative(),
    encoding: z.literal("utf8"),
    captureSource: z.enum(["hook", "mcp", "fixture", "repository"]),
    captureCompleteness: CaptureCompletenessSchema,
    privacyClass: PrivacyClassSchema,
    truncationFlag: z.boolean(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable()
});
export const ChunkSchema = z.object({
    chunkId: z.string(),
    artifactId: z.string(),
    startByte: z.number().int().nonnegative(),
    endByte: z.number().int().nonnegative(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    parserKind: z.string(),
    sourcePath: z.string().nullable(),
    sourceHash: z.string().nullable(),
    pinnedEvidence: z.boolean(),
    text: z.string()
});
export const CriterionStatusSchema = z.enum([
    "supported",
    "failed",
    "unknown",
    "not_applicable"
]);
export const CriterionSchema = z.object({
    criterionId: z.string(),
    workspaceId: z.string(),
    sessionId: z.string(),
    text: z.string().min(1),
    provenance: z.enum(["explicit_user", "project_instruction", "inferred"]),
    status: CriterionStatusSchema,
    evidenceRefs: z.array(z.string()),
    observedRevision: z.string().nullable(),
    unresolvedQuestion: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});
export const SelectionSchema = z.object({
    artifactId: z.string(),
    mode: z.enum(["passthrough", "deterministic", "deterministic_with_provider"]),
    selectedChunkIds: z.array(z.string()),
    omittedChunkCount: z.number().int().nonnegative(),
    reasonCodes: z.array(z.string()),
    estimatedTokens: z.number().int().nonnegative(),
    expansionCursor: z.string().nullable(),
    fallbackMode: z.string().nullable()
});
export const RepositoryExcerptSchema = z.object({
    path: z.string(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    contentHash: z.string(),
    excerpt: z.string(),
    reason: z.string()
});
