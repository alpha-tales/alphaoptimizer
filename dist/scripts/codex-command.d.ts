import spawn from "cross-spawn";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
export { spawn };
/** Resolve npm's Windows .cmd shim without hand-building shell command strings. */
export declare function codexSync(args: string[], options?: SpawnSyncOptionsWithStringEncoding): string;
