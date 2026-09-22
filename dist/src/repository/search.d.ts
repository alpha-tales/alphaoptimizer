import { RepositoryExcerpt } from "../contracts/schemas.js";
export declare function searchRepository(input: {
    workspace: string;
    query: string;
    allowlist?: string[];
    limit?: number;
    contextLines?: number;
    maxFileBytes?: number;
    maxScanFiles?: number;
    maxScanBytes?: number;
    signal?: AbortSignal;
}): Promise<RepositoryExcerpt[]>;
