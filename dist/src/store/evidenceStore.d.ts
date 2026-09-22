import Database from "better-sqlite3";
import { ArtifactRecord, Chunk, Criterion, CriterionStatus, ToolObservation } from "../contracts/schemas.js";
type CaptureOptions = {
    captureSource: "hook" | "mcp" | "fixture" | "repository";
    expiresAt?: string | null;
    leaseId?: string;
};
export declare class EvidenceStore {
    private readonly policy;
    readonly db: Database.Database;
    readonly dataDir: string;
    readonly artifactDir: string;
    private readonly rawBudget;
    constructor(dataDir: string, policy?: {
        maxStoreBytes: number;
        quotaPolicy: "oldest_unprotected" | "reject";
    });
    close(): void;
    migrate(): void;
    private recoverArtifactFiles;
    cleanupExpired(now?: string): number;
    /** The write lock covers quota admission, metadata, and chunk indexing across processes. */
    captureObservation(observation: ToolObservation, options: CaptureOptions): ArtifactRecord;
    retainResponseLease(leaseId: string, artifactId: string): boolean;
    private captureObservationLocked;
    replaceChunks(artifactId: string, chunks: Chunk[]): void;
    getArtifact(artifactId: string, scope?: {
        workspaceId: string;
        sessionId: string;
    }): ArtifactRecord | null;
    getChunks(artifactId: string, scope?: {
        workspaceId: string;
        sessionId: string;
    }): Chunk[];
    readArtifactRange(artifactId: string, startByte?: number, maxBytes?: number, scope?: {
        workspaceId: string;
        sessionId: string;
    }): {
        text: string;
        nextCursor: number | null;
    };
    searchArtifactText(artifactId: string, query: string, maxBytes?: number, scope?: {
        workspaceId: string;
        sessionId: string;
    }, cursor?: string): {
        chunks: Array<Chunk & {
            partial: boolean;
            sourceChunkIds: string[];
        }>;
        omittedChunks: number;
        hasMore: boolean;
        nextCursor: string | null;
    };
    upsertCriterion(input: {
        workspaceId: string;
        sessionId: string;
        text: string;
        provenance: "explicit_user" | "project_instruction" | "inferred";
        status?: CriterionStatus;
        evidenceRefs?: string[];
        observedRevision?: string | null;
        unresolvedQuestion?: string | null;
    }): Criterion;
    listCriteria(workspaceId: string, sessionId: string): Criterion[];
    private artifactPath;
}
export {};
