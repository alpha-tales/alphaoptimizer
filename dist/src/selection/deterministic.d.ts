import { Chunk, Selection } from "../contracts/schemas.js";
type SelectionOptions = {
    tokenBudget: number;
    goal?: string;
    relevantIds?: Set<string>;
    providerStatus?: string;
    signal?: AbortSignal;
};
export declare function selectDeterministic(chunks: Chunk[], options: SelectionOptions): Selection;
export declare function selectDeterministicAsync(chunks: Chunk[], options: SelectionOptions): Promise<Selection>;
export declare function renderSelection(chunks: Chunk[], selection: Selection): string;
export {};
