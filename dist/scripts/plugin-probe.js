import path from "node:path";
import { spawn } from "node:child_process";
const bundle = path.join(process.cwd(), "release", `alphaoptimizer-${process.platform}-${process.arch}-node${process.versions.node.split(".")[0]}`);
const child = spawn(process.execPath, ["dist/scripts/auto-hook-probe.js", "mcp"], {
    env: { ...process.env, ALPHA_PROBE_PLUGIN_ROOT: bundle },
    stdio: "inherit",
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("close", code => { process.exitCode = code ?? 1; });
