import spawn from "cross-spawn";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";

export { spawn };

/** Resolve npm's Windows .cmd shim without hand-building shell command strings. */
export function codexSync(args: string[], options: SpawnSyncOptionsWithStringEncoding = { encoding: "utf8" }): string {
  const result = spawn.sync("codex", args, { ...options, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Codex exited ${result.status}: ${result.stderr ?? ""}`);
  return result.stdout ?? "";
}
