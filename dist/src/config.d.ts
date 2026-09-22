import { z } from "zod";
export declare const ConfigSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<{
        filter: "filter";
        observe: "observe";
        off: "off";
    }>>;
    dataDir: z.ZodDefault<z.ZodString>;
    retentionDays: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    maxStoreBytes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    quotaPolicy: z.ZodDefault<z.ZodEnum<{
        oldest_unprotected: "oldest_unprotected";
        reject: "reject";
    }>>;
    maxArtifactBytes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    selectionTokenBudget: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    selectionThresholdTokens: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    repositoryMaxFileBytes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    workspaceAllowlist: z.ZodDefault<z.ZodArray<z.ZodString>>;
    unrestrictedWorkspaces: z.ZodPreprocess<z.ZodDefault<z.ZodBoolean>, unknown>;
    sessionId: z.ZodString;
    metricsEnabled: z.ZodDefault<z.ZodBoolean>;
    autoMode: z.ZodDefault<z.ZodEnum<{
        filter: "filter";
        observe: "observe";
        off: "off";
    }>>;
    autoJevEnabled: z.ZodDefault<z.ZodBoolean>;
    jevEnabled: z.ZodPreprocess<z.ZodDefault<z.ZodBoolean>, unknown>;
    jevDataSharing: z.ZodPreprocess<z.ZodDefault<z.ZodBoolean>, unknown>;
    jevTermsAccepted: z.ZodPreprocess<z.ZodDefault<z.ZodBoolean>, unknown>;
    jevEndpoint: z.ZodOptional<z.ZodString>;
    jevApiKey: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AlphaOptimizerConfig = z.infer<typeof ConfigSchema>;
export declare function loadConfig(env?: NodeJS.ProcessEnv): AlphaOptimizerConfig;
