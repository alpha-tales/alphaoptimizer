/** Explicit user-invoked installation. Only this hook's definition/hash and auto-mode setting change. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { spawn } from "./codex-command.js";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { z } from "zod";
import { automaticHookGroup } from "../src/hooks/definition.js";
import { mergeOutputPolicy } from "../src/hooks/policy.js";

class SetupError extends Error {}

const run = promisify(execFile);
const disable = process.argv.includes("--disable");
const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
const hooksPath = path.join(home, "hooks.json");
const configPath = path.join(home, "config.toml");
const handler = z
  .object({
    type: z.string(),
    server: z.string().optional(),
    tool: z.string().optional(),
  })
  .passthrough();
const group = z.object({ hooks: z.array(handler) }).passthrough();
const document = z
  .object({ hooks: z.record(z.string(), z.array(group)).default({}) })
  .passthrough();
let child: ReturnType<typeof spawn> | undefined;
try {
  // Capture output privately: mcp get can contain environment credentials.
  await run("codex", ["mcp", "get", "alphaoptimizer", "--json"], {
    timeout: 10000,
  });
  if (!disable) {
    const proof = JSON.parse(
      await fs.readFile("docs/automatic-hook-probe.json", "utf8"),
    );
    const version = (await run("codex", ["--version"])).stdout.trim();
    if (
      proof.codex !== version ||
      !["mcp", "code_bridge"].every((mode) =>
        proof.results.some(
          (r: {
            mode: string;
            exitCode: number;
            calls: number;
            sawRaw: boolean;
            sawKept: boolean;
            sawFeedback: boolean;
          }) =>
            r.mode === mode &&
            r.exitCode === 0 &&
            r.calls === 2 &&
            !r.sawRaw &&
            r.sawKept &&
            r.sawFeedback,
        ),
      )
    )
      throw new SetupError(
        "Run the automatic hook host probe successfully before installation.",
      );
  }
  let original = "";
  try {
    original = await fs.readFile(hooksPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const doc = document.parse(original ? JSON.parse(original) : {});
  const existing = doc.hooks.PostToolUse ?? [];
  const isOurs = (h: z.infer<typeof handler>) =>
    h.type === "mcp_tool" &&
    h.server === "alphaoptimizer" &&
    h.tool === "process_tool_result";
  let found = false;
  const retained = existing.map((g) => {
    if (!g.hooks.some(isOurs) && g.matcher !== "^alphaoptimizer-disabled$")
      return g;
    if (g.hooks.some((h) => !isOurs(h)))
      throw new SetupError(
        "AlphaOptimizer shares a hook group with other handlers; no hook configuration was changed.",
      );
    if (found)
      throw new SetupError(
        "Duplicate automatic hook definitions; no hook configuration was changed.",
      );
    found = true;
    // Keep other groups' indices/trust keys stable when disabling or reinstalling.
    return disable
      ? { matcher: "^alphaoptimizer-disabled$", hooks: [] }
      : automaticHookGroup;
  });
  doc.hooks.PostToolUse =
    !found && !disable ? [...retained, automaticHookGroup] : retained;
  const updated = JSON.stringify(doc, null, 2) + "\n";
  const temp = `${hooksPath}.alphaoptimizer-${process.pid}.tmp`;
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const current = await fs
    .readFile(hooksPath, "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  if (current !== original)
    throw new SetupError("Hook configuration changed concurrently; retry.");
  await fs.writeFile(temp, updated, { flag: "wx", mode: 0o600 });
  await fs.rename(temp, hooksPath);

  // Use Codex's ordinary config API to review/trust this exact hash, never a global trust bypass.
  child = spawn("codex", ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  let id = 0;
  const lines = createInterface({ input: child.stdout! });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      if (message.error)
        task.reject(
          new SetupError("Codex configuration API rejected a request."),
        );
      else task.resolve(message.result);
    } catch {
      /* Ignore non-protocol stdout; never echo credentials. */
    }
  });
  child.on("error", () => {
    for (const task of pending.values())
      task.reject(new SetupError("Could not start Codex config API."));
  });
  async function rpc(method: string, params: unknown): Promise<unknown> {
    const request = ++id;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await new Promise((resolve, reject) => {
        pending.set(request, { resolve, reject });
        timer = setTimeout(() => {
          pending.delete(request);
          reject(new SetupError("Codex configuration request timed out."));
        }, 15000);
        child!.stdin!.write(
          JSON.stringify({ id: request, method, params }) + "\n",
        );
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  await rpc("initialize", {
    clientInfo: { name: "alphaoptimizer-hook-installer", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin!.write(JSON.stringify({ method: "initialized" }) + "\n");
  const listings = z.object({
    data: z.array(
      z.object({
        errors: z.array(z.unknown()),
        hooks: z.array(
          z.object({
            key: z.string(),
            currentHash: z.string(),
            sourcePath: z.string(),
            trustStatus: z.string(),
            server: z.string().optional(),
            tool: z.string().optional(),
          }),
        ),
      }),
    ),
  });
  if (!disable) {
    const listing = listings.parse(
      await rpc("hooks/list", { cwds: [process.cwd()] }),
    );
    if (listing.data.some((entry) => entry.errors.length))
      throw new SetupError(
        "Codex reported hook configuration errors; auto mode was not enabled.",
      );
    const ours = listing.data
      .flatMap((entry) => entry.hooks)
      .find(
        (h) =>
          h.sourcePath === hooksPath &&
          h.server === "alphaoptimizer" &&
          h.tool === "process_tool_result",
      );
    if (!ours)
      throw new SetupError(
        "Codex did not discover the new hook; auto mode was not enabled.",
      );
    await rpc("config/value/write", {
      filePath: configPath,
      keyPath: `hooks.state.${JSON.stringify(ours.key)}.trusted_hash`,
      value: ours.currentHash,
      mergeStrategy: "upsert",
    });
    const verified = listings.parse(
      await rpc("hooks/list", { cwds: [process.cwd()] }),
    );
    if (
      !verified.data
        .flatMap((entry) => entry.hooks)
        .some(
          (h) =>
            h.key === ours.key &&
            h.currentHash === ours.currentHash &&
            h.trustStatus === "trusted",
        )
    )
      throw new SetupError(
        "Exact hook trust was not confirmed; auto mode was not enabled.",
      );
  }
  await rpc("config/value/write", {
    filePath: configPath,
    keyPath: "mcp_servers.alphaoptimizer.env.ALPHAOPTIMIZER_AUTO_MODE",
    value: disable ? "off" : "filter",
    mergeStrategy: "upsert",
  });
  await fs.chmod(configPath, 0o600);
  const instructionsPath = path.join(home, "AGENTS.md");
  const instructions = await fs
    .readFile(instructionsPath, "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  const nextInstructions = mergeOutputPolicy(instructions, !disable);
  const instructionsTemp = `${instructionsPath}.alphaoptimizer-${process.pid}.tmp`;
  await fs.writeFile(instructionsTemp, nextInstructions, {
    flag: "wx",
    mode: 0o600,
  });
  const latestInstructions = await fs
    .readFile(instructionsPath, "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  if (latestInstructions !== instructions) {
    await fs.rm(instructionsTemp);
    throw new SetupError(
      "Instructions changed concurrently; rerun the installer.",
    );
  }
  await fs.rename(instructionsTemp, instructionsPath);
  console.log(
    disable
      ? "Removed only AlphaOptimizer's automatic hook and output policy. Restart Codex."
      : "Installed and trusted only AlphaOptimizer's PostToolUse hook, with a code-mode emission policy. Other hooks and permissions are preserved. Restart Codex to load the updated server and instructions.",
  );
  lines.close();
} catch (error) {
  // Only our static messages are safe; subprocess errors can embed config output with credentials.
  const message =
    error instanceof SetupError
      ? error.message
      : "Installation could not complete; existing credentials were not displayed.";
  console.error(message);
  process.exitCode = 1;
} finally {
  child?.kill("SIGTERM");
}
