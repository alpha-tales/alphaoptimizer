import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { ModeSchema } from "./contracts/schemas.js";
const StrictBooleanSchema = z.preprocess((value) => {
    if (typeof value === "boolean")
        return value;
    if (typeof value !== "string" || value.length === 0)
        return undefined;
    if (["true", "1", "yes", "on"].includes(value.toLowerCase()))
        return true;
    if (["false", "0", "no", "off"].includes(value.toLowerCase()))
        return false;
    return value;
}, z.boolean().default(false));
export const ConfigSchema = z.object({
    mode: ModeSchema.default("observe"),
    dataDir: z
        .string()
        .default(path.join(os.homedir(), ".local", "share", "alphaoptimizer")),
    retentionDays: z.coerce.number().int().positive().default(14),
    maxStoreBytes: z.coerce
        .number()
        .int()
        .min(1024 * 1024)
        .default(256 * 1024 * 1024),
    quotaPolicy: z
        .enum(["oldest_unprotected", "reject"])
        .default("oldest_unprotected"),
    maxArtifactBytes: z.coerce
        .number()
        .int()
        .positive()
        .default(8 * 1024 * 1024),
    selectionTokenBudget: z.coerce.number().int().positive().default(1500),
    selectionThresholdTokens: z.coerce.number().int().positive().default(4000),
    repositoryMaxFileBytes: z.coerce
        .number()
        .int()
        .positive()
        .default(512 * 1024),
    workspaceAllowlist: z.array(z.string()).default([]),
    unrestrictedWorkspaces: StrictBooleanSchema,
    sessionId: z.string().min(1),
    metricsEnabled: z.boolean().default(true),
    autoMode: z.enum(["off", "observe", "filter"]).default("off"),
    autoJevEnabled: z.boolean().default(false),
    jevEnabled: StrictBooleanSchema,
    jevDataSharing: StrictBooleanSchema,
    jevTermsAccepted: StrictBooleanSchema,
    jevEndpoint: z.string().url().optional(),
    jevApiKey: z.string().optional(),
});
export function loadConfig(env = process.env) {
    const unrestrictedWorkspaces = StrictBooleanSchema.parse(env.ALPHAOPTIMIZER_UNRESTRICTED_WORKSPACES);
    const configuredAllowlist = env.ALPHAOPTIMIZER_WORKSPACES?.split(":").filter(Boolean);
    const allowlist = configuredAllowlist && configuredAllowlist.length > 0
        ? configuredAllowlist
        : unrestrictedWorkspaces
            ? []
            : [process.cwd()];
    return ConfigSchema.parse({
        mode: env.ALPHAOPTIMIZER_MODE,
        dataDir: env.ALPHAOPTIMIZER_DATA_DIR,
        retentionDays: env.ALPHAOPTIMIZER_RETENTION_DAYS,
        maxStoreBytes: env.ALPHAOPTIMIZER_MAX_STORE_BYTES,
        quotaPolicy: env.ALPHAOPTIMIZER_QUOTA_POLICY,
        maxArtifactBytes: env.ALPHAOPTIMIZER_MAX_ARTIFACT_BYTES,
        selectionTokenBudget: env.ALPHAOPTIMIZER_SELECTION_TOKEN_BUDGET,
        selectionThresholdTokens: env.ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS,
        repositoryMaxFileBytes: env.ALPHAOPTIMIZER_REPOSITORY_MAX_FILE_BYTES,
        workspaceAllowlist: allowlist,
        unrestrictedWorkspaces,
        sessionId: env.ALPHAOPTIMIZER_SESSION_ID ?? `server-${crypto.randomUUID()}`,
        metricsEnabled: StrictBooleanSchema.parse(env.ALPHAOPTIMIZER_METRICS_ENABLED ?? "true"),
        jevEnabled: env.ALPHAOPTIMIZER_JEV_ENABLED,
        autoMode: env.ALPHAOPTIMIZER_AUTO_MODE,
        autoJevEnabled: StrictBooleanSchema.parse(env.ALPHAOPTIMIZER_AUTO_JEV_ENABLED),
        jevDataSharing: env.ALPHAOPTIMIZER_JEV_DATA_SHARING,
        jevTermsAccepted: env.ALPHAOPTIMIZER_JEV_TERMS_ACCEPTED,
        jevEndpoint: env.ALPHAOPTIMIZER_JEV_ENDPOINT,
        jevApiKey: env.ALPHAOPTIMIZER_JEV_API_KEY,
    });
}
