export declare const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export type JevDecision = {
    id: string;
    verdict: "relevant" | "irrelevant" | "uncertain";
    probability: number;
};
export declare class JevProvider {
    private readonly config;
    constructor(config: {
        endpoint?: string;
        apiKey?: string;
        enabled: boolean;
        model?: string;
        maxRequestBytes?: number;
    });
    classify(input: {
        signal?: AbortSignal;
        onRequest?: () => void;
        onUsage?: (usage: {
            input_tokens: number;
            output_tokens: number;
        }) => void;
        goal: string;
        candidates: Array<{
            id: string;
            text: string;
        }>;
        privacyClass?: "normal" | "sensitive" | "secret";
    }): Promise<JevDecision[]>;
}
