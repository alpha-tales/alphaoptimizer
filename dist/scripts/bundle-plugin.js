/** Build a platform-specific plugin with its own Node and native dependencies. */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const root = process.cwd();
const destination = path.join(root, "release", `alphaoptimizer-${process.platform}-${process.arch}-node${process.versions.node.split(".")[0]}`);
await fs.rm(destination, { recursive: true, force: true });
await fs.mkdir(path.join(destination, "runtime"), { recursive: true });
const manifest = JSON.parse(await fs.readFile("package.json", "utf8"));
for (const entry of [...manifest.files, "package.json", "package-lock.json", "LICENSE"]) {
    await fs.cp(path.join(root, entry), path.join(destination, entry), { recursive: true });
}
const env = { ...process.env };
delete env.ALPHAOPTIMIZER_JEV_API_KEY;
await promisify(execFile)(process.execPath, [process.env.npm_execpath, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: destination, env, timeout: 120000,
});
const executable = process.platform === "win32" ? "node.exe" : "node";
await fs.copyFile(process.execPath, path.join(destination, "runtime", executable));
await fs.chmod(path.join(destination, "runtime", executable), 0o755);
const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`, { signal: AbortSignal.timeout(30000) });
if (!license.ok)
    throw new Error("Cannot bundle Node without its license notices");
await fs.writeFile(path.join(destination, "runtime", "LICENSE"), await license.text());
const mcp = JSON.parse(await fs.readFile(path.join(destination, ".mcp.json"), "utf8"));
mcp.mcpServers.alphaoptimizer.command = `./runtime/${executable}`;
await fs.writeFile(path.join(destination, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
const hooks = JSON.parse(await fs.readFile(path.join(destination, "hooks/hooks.json"), "utf8"));
const session = hooks.hooks.SessionStart[0].hooks[0];
session.command = '"${PLUGIN_ROOT}/runtime/node" "${PLUGIN_ROOT}/dist/src/hooks/session-start.js"';
session.commandWindows = '& "${PLUGIN_ROOT}/runtime/node.exe" "${PLUGIN_ROOT}/dist/src/hooks/session-start.js"';
await fs.writeFile(path.join(destination, "hooks/hooks.json"), JSON.stringify(hooks, null, 2) + "\n");
// Verify the bundled executable and actual native SQLite binding together, before distribution.
await promisify(execFile)(path.join(destination, "runtime", executable), ["--input-type=module", "-e", "import Database from 'better-sqlite3'; const db=new Database(':memory:'); db.prepare('SELECT 1').get(); db.close();"], { cwd: destination });
const client = new Client({ name: "bundled-runtime-smoke", version: "1" });
const data = await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "alpha-bundle-"));
try {
    const configuration = mcp.mcpServers.alphaoptimizer;
    await client.connect(new StdioClientTransport({
        command: path.resolve(destination, configuration.command),
        args: configuration.args,
        cwd: destination,
        env: { PATH: "", ALPHAOPTIMIZER_JEV_API_KEY: "synthetic", ALPHAOPTIMIZER_DATA_DIR: path.join(data, "store") },
    }));
    const status = await client.callTool({ name: "optimization_status", arguments: {} });
    const result = JSON.parse(status.content[0].text);
    if (result.state !== "awaiting_hook_verification")
        throw new Error("Bundled MCP did not initialize with key-only configuration");
}
finally {
    await client.close();
    await fs.rm(data, { recursive: true, force: true });
}
console.log(`Platform plugin built and native SQLite verified: ${destination}`);
