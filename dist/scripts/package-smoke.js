import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const run = promisify(execFile);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-package-"));
try {
    await run(process.execPath, [process.env.npm_execpath, "pack", "--pack-destination", temporary], {
        timeout: 120000,
    });
    const archive = (await fs.readdir(temporary)).find((name) => name.endsWith(".tgz"));
    const install = path.join(temporary, "install");
    await fs.mkdir(install);
    await run(process.execPath, [
        process.env.npm_execpath,
        "install",
        "--prefix",
        install,
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        path.join(temporary, archive),
    ], { timeout: 120000 });
    const configPath = path.join(install, "node_modules", "alphaoptimizer", ".mcp.json");
    const text = await fs.readFile(configPath, "utf8");
    assert.ok(!text.includes("/Users/") && !text.includes(process.cwd()));
    const configuration = JSON.parse(text).mcpServers.alphaoptimizer;
    const workspace = path.join(temporary, "unrelated-project");
    await fs.mkdir(workspace);
    const client = new Client({ name: "installed-package-smoke", version: "1" });
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: configuration.args,
        cwd: path.resolve(path.dirname(configPath), configuration.cwd),
        env: {
            ...environment,
            ...configuration.env,
            ALPHAOPTIMIZER_JEV_API_KEY: "",
            PATH: `${path.join(install, "node_modules", ".bin")}${path.delimiter}${process.env.PATH}`,
            ALPHAOPTIMIZER_DATA_DIR: path.join(temporary, "data"),
        },
    });
    try {
        await client.connect(transport);
        assert.ok((await client.listTools()).tools.some((tool) => tool.name === "process_tool_result"));
        const hooks = JSON.parse(await fs.readFile(path.join(path.dirname(configPath), "hooks/hooks.json"), "utf8"));
        assert.equal(hooks.hooks.PostToolUse[0].hooks[0].tool, "process_tool_result");
        assert.equal(hooks.hooks.SessionStart[0].hooks[0].type, "command");
        const status = await client.callTool({ name: "optimization_status", arguments: {} });
        const health = JSON.parse(status.content[0].text);
        assert.equal(health.autoMode, "filter");
        assert.equal(health.state, "inactive");
        assert.equal(health.jevKeyConfigured, false);
        const content = "synthetic installed evidence\n".repeat(1000);
        const result = await client.callTool({
            name: "select_evidence",
            arguments: { workspace, content },
        });
        assert.ok(!result.isError);
        const receipt = JSON.parse(result.content[0].text);
        assert.equal(receipt.artifact, null);
        assert.equal(receipt.selectedText, content);
        assert.match(receipt.fallbackReason, /jev unavailable/);
    }
    finally {
        await client.close();
    }
    // A Codex plugin cache does not run npm install. Exercise that exact missing-dependency case.
    const pluginCache = path.join(temporary, "plugin cache with spaces");
    await fs.cp(path.dirname(configPath), pluginCache, {
        recursive: true,
        filter: (source) => !path.relative(path.dirname(configPath), source).split(path.sep).includes("node_modules"),
    });
    const fresh = new Client({ name: "fresh-plugin-cache", version: "1" });
    try {
        await fresh.connect(new StdioClientTransport({
            command: process.execPath,
            args: [path.join(pluginCache, "scripts/start.mjs")],
            cwd: workspace,
            env: { ...environment, ALPHAOPTIMIZER_JEV_API_KEY: "", PLUGIN_DATA: path.join(temporary, "plugin data"), ALPHAOPTIMIZER_DATA_DIR: path.join(temporary, "fresh data") },
        }), { timeout: 120000 });
        const result = await fresh.callTool({ name: "optimization_status", arguments: {} });
        assert.equal(JSON.parse(result.content[0].text).autoMode, "filter");
    }
    finally {
        await fresh.close();
    }
    console.log("PASS: packed installation and fresh plugin cache boot from unrelated cwd; hooks ship, filtering defaults on, missing key is reported, native dependencies initialize automatically.");
}
finally {
    await fs.rm(temporary, { recursive: true, force: true });
}
