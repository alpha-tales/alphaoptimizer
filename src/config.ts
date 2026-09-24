import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { ModeSchema } from "./contracts/schemas.js";

const StrictBooleanSchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  return value;
}, z.boolean().default(false));

export const ConfigSchema = z.object({
  mode: ModeSchema.default("filter"),
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
  sessionId: z.string().min(1),
  metricsEnabled: z.boolean().default(true),
  autoMode: z.enum(["off", "observe", "filter"]).default("filter"),
  jevEndpoint: z.string().url().optional(),
  jevApiKey: z.string().optional(),
});

export type AlphaOptimizerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AlphaOptimizerConfig {
  const configuredAllowlist =
    env.ALPHAOPTIMIZER_WORKSPACES?.split(path.delimiter).filter(Boolean);

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
    workspaceAllowlist: configuredAllowlist ?? [],
    sessionId: env.ALPHAOPTIMIZER_SESSION_ID ?? `server-${crypto.randomUUID()}`,
    metricsEnabled: StrictBooleanSchema.parse(
      env.ALPHAOPTIMIZER_METRICS_ENABLED ?? "true",
    ),
    autoMode: env.ALPHAOPTIMIZER_AUTO_MODE,
    jevEndpoint: env.ALPHAOPTIMIZER_JEV_ENDPOINT,
    jevApiKey: env.ALPHAOPTIMIZER_JEV_API_KEY,
  });
}
