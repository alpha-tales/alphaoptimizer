// Start from any workspace, including a plugin cache without node_modules.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const major = Number(process.versions.node.split(".")[0]);
if (![22, 24].includes(major)) {
  throw new Error("AlphaOptimizer requires Node 22 or 24. Automatic optimization is inactive.");
}

async function ready(directory) {
  try {
    const require = createRequire(path.join(directory, "package.json"));
    for (const name of ["@modelcontextprotocol/sdk/server/mcp.js", "zod", "undici"])
      require.resolve(name);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.prepare("SELECT 1").get();
    db.close();
    await fs.access(path.join(directory, "dist/src/server.js"));
    return true;
  } catch { return false; }
}

let runtime = root;
if (!(await ready(root))) {
  const lock = await fs.readFile(path.join(root, "runtime-lock.json"));
  const manifest = await fs.readFile(path.join(root, "package.json"));
  // Include code and ABI so upgrades never reuse stale JS or native modules.
  async function hashTree(directory) {
    const hash = createHash("sha256");
    for (const name of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, name);
      hash.update(name);
      hash.update((await fs.stat(file)).isDirectory() ? await hashTree(file) : await fs.readFile(file));
    }
    return hash.digest();
  }
  const id = createHash("sha256").update(lock).update(manifest)
    .update(await hashTree(path.join(root, "dist/src")))
    .update(`${process.platform}-${process.arch}-${process.versions.modules}`).digest("hex");
  const cache = path.join(process.env.PLUGIN_DATA || path.join(os.homedir(), ".cache", "alphaoptimizer"), "runtime");
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  runtime = path.join(cache, id);
  if (!(await ready(runtime))) {
    const staging = await fs.mkdtemp(path.join(cache, "install-"));
    try {
      await fs.writeFile(path.join(staging, "package.json"), manifest);
      await fs.writeFile(path.join(staging, "package-lock.json"), lock);
      await fs.cp(path.join(root, "dist/src"), path.join(staging, "dist/src"), { recursive: true });
      console.error("AlphaOptimizer: preparing locked runtime dependencies for this platform.");
      // Never inherit the Jev key into an installation subprocess. No package lifecycle scripts.
      const env = { ...process.env };
      delete env.ALPHAOPTIMIZER_JEV_API_KEY;
      await new Promise((resolve, reject) => {
        const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm",
          ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
          { cwd: staging, env, shell: process.platform === "win32", stdio: ["ignore", "ignore", "pipe"] });
        // Keep installer diagnostics off the MCP stdout channel and avoid leaking registry credentials.
        child.stderr.resume();
        const timer = setTimeout(() => child.kill(), 100000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Runtime dependency setup failed (${code}); automatic optimization is inactive.`)); });
      });
      if (!(await ready(staging))) throw new Error("Native SQLite runtime validation failed; automatic optimization is inactive.");
      try { await fs.rename(staging, runtime); }
      catch (error) { if (!(await ready(runtime))) throw error; }
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
}
await import(pathToFileURL(path.join(runtime, "dist/src/server.js")).href);
