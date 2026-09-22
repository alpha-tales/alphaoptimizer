/** Real CLI + local synthetic model: checks the shipped MCP hook, not a simulated hook response. */
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-auto-probe-"));
const omitted = "ALPHA_AUTO_OMITTED_63731";
const kept = "ALPHA_AUTO_PRESERVED_92461";
const text = Array.from({ length: 120 }, (_, i) => i === 60
    ? omitted
    : `Routine processing item ${i}: background processing completed normally.`).join("\n") + `\nERROR ${kept}: synthetic diagnostic.\n`;
const modes = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["shell", "mcp", "code", "code_bridge", "baseline"];
const results = [];
try {
    const emitter = path.join(temporary, "emit.cjs");
    await fs.writeFile(emitter, `process.stdout.write(${JSON.stringify(text)})`);
    const fixture = path.join(temporary, "fixture.mjs");
    const sdk = path.join(root, "node_modules/@modelcontextprotocol/sdk/dist/esm");
    await fs.writeFile(fixture, `import {McpServer} from ${JSON.stringify(pathToFileURL(path.join(sdk, "server/mcp.js")).href)};import {StdioServerTransport} from ${JSON.stringify(pathToFileURL(path.join(sdk, "server/stdio.js")).href)};const s=new McpServer({name:"fixture",version:"1"});s.registerTool("emit",{inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async()=>({content:[{type:"text",text:${JSON.stringify(text)}}]}));await s.connect(new StdioServerTransport());`);
    await Promise.all(modes.map(async (mode) => {
        const workspace = path.join(temporary, mode);
        await fs.mkdir(workspace);
        let calls = 0, sawRaw = false, sawKept = false, sawFeedback = false;
        let toolNames = [];
        let capturedOutput;
        let scenarioError = null;
        const api = http.createServer(async (req, res) => {
            let body = "";
            for await (const chunk of req)
                body += chunk;
            try {
                if (!body) {
                    res.writeHead(200);
                    res.end("{}");
                    return;
                }
                const request = JSON.parse(body);
                calls++;
                if (calls > 1) {
                    const inputs = request.input ?? [];
                    const outputs = inputs.filter((item) => /tool_call_output|function_call_output/.test(item.type ?? ""));
                    capturedOutput = outputs;
                    const serialized = JSON.stringify(outputs);
                    sawRaw ||= serialized.includes(omitted);
                    sawKept ||= serialized.includes(kept);
                    sawFeedback ||= serialized.includes("Reduced tool result");
                }
                const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(emitter)}`;
                let output;
                if (calls === 1) {
                    const specs = (request.tools ?? []).flatMap((t) => t.tools ? t.tools.map((s) => ({ ...s, namespace: t.name })) : [t]);
                    toolNames = specs
                        .filter((t) => ["exec", "exec_command", "shell_command"].includes(t.name) ||
                        /alphaoptimizer|fixture/.test(t.namespace ?? ""))
                        .map((t) => `${t.namespace ?? ""}/${t.name}:${t.type}`);
                    if (mode === "code" || mode === "code_bridge") {
                        const exec = specs.find((t) => t.name === "exec");
                        if (!exec)
                            throw new Error("Code-mode exec tool is not exposed");
                        const hookInput = {
                            hook_event_name: "PostToolUse",
                            cwd: workspace,
                            session_id: "code-bridge",
                            tool_use_id: "bridge-1",
                            tool_name: "Bash",
                            tool_input: { command },
                        };
                        const script = mode === "code_bridge"
                            ? `const r = await tools.exec_command(${JSON.stringify({ cmd: command, max_output_tokens: 15000 })}); const f = await tools.mcp__alphaoptimizer__process_tool_result({...${JSON.stringify(hookInput)},tool_response:r.output,exit_code:r.exit_code}); const h = f.structuredContent ?? JSON.parse(f.content.find(c=>c.type==="text").text); text(h.continue===false ? {exit_code:r.exit_code,output:h.stopReason} : r);`
                            : `const r = await tools.exec_command(${JSON.stringify({ cmd: command, max_output_tokens: 15000 })}); text(r);`;
                        output = {
                            type: "custom_tool_call",
                            id: "ct_probe",
                            call_id: "call_probe",
                            name: exec.name,
                            ...(exec.namespace ? { namespace: exec.namespace } : {}),
                            input: script,
                            status: "completed",
                        };
                    }
                    else {
                        const name = mode === "mcp"
                            ? "emit"
                            : specs.some((s) => s.name === "exec_command")
                                ? "exec_command"
                                : "shell_command";
                        output = {
                            type: "function_call",
                            id: "fc_probe",
                            call_id: "call_probe",
                            name,
                            status: "completed",
                            ...(mode === "mcp" ? { namespace: "mcp__fixture" } : {}),
                            arguments: JSON.stringify(mode === "mcp"
                                ? {}
                                : name === "exec_command"
                                    ? { cmd: command, max_output_tokens: 15000 }
                                    : { command }),
                        };
                    }
                }
                else
                    output = {
                        type: "message",
                        id: "msg_probe",
                        role: "assistant",
                        status: "completed",
                        content: [
                            {
                                type: "output_text",
                                text: "Probe complete.",
                                annotations: [],
                            },
                        ],
                    };
                res.writeHead(200, { "content-type": "text/event-stream" });
                const response = {
                    id: `resp_${calls}`,
                    object: "response",
                    created_at: Math.floor(Date.now() / 1000),
                    model: "probe",
                    status: "completed",
                    output: [output],
                    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                };
                for (const event of [
                    {
                        type: "response.created",
                        response: { ...response, status: "in_progress", output: [] },
                    },
                    {
                        type: "response.output_item.added",
                        output_index: 0,
                        item: output,
                    },
                    {
                        type: "response.output_item.done",
                        output_index: 0,
                        item: output,
                    },
                    { type: "response.completed", response },
                ])
                    res.write(`data: ${JSON.stringify(event)}\n\n`);
                res.end();
            }
            catch (error) {
                scenarioError = error.message;
                res.writeHead(500);
                res.end();
            }
        });
        await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
        const port = api.address().port;
        const hook = {
            matcher: "*",
            hooks: [
                {
                    type: "mcp_tool",
                    server: "alphaoptimizer",
                    tool: "process_tool_result",
                    timeout: 5,
                    input: {
                        hook_event_name: "PostToolUse",
                        cwd: "${cwd}",
                        session_id: "${session_id}",
                        tool_use_id: "${tool_use_id}",
                        tool_name: "${tool_name}",
                        tool_input: "${tool_input}",
                        tool_response: "${tool_response}",
                    },
                },
            ],
        };
        const flags = [
            `model_provider="probe"`,
            `model="probe"`,
            `model_providers.probe={name="probe",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`,
            `mcp_servers.alphaoptimizer.command=${JSON.stringify(process.execPath)}`,
            `mcp_servers.alphaoptimizer.args=[${JSON.stringify(path.join(root, "dist/src/server.js"))}]`,
            `mcp_servers.alphaoptimizer.env={ALPHAOPTIMIZER_DATA_DIR=${JSON.stringify(path.join(workspace, "data"))},ALPHAOPTIMIZER_WORKSPACES=${JSON.stringify(workspace)},ALPHAOPTIMIZER_AUTO_MODE=${JSON.stringify(mode === "baseline" ? "off" : "filter")},ALPHAOPTIMIZER_JEV_ENABLED="false"}`,
            `mcp_servers.alphaoptimizer.tools.process_tool_result.approval_mode="approve"`,
            `mcp_servers.fixture.command=${JSON.stringify(process.execPath)}`,
            `mcp_servers.fixture.args=[${JSON.stringify(fixture)}]`,
            `mcp_servers.fixture.tools.emit.approval_mode="approve"`,
            `hooks.PostToolUse=[${toToml(hook)}]`,
            `features.code_mode_host=${mode.startsWith("code")}`,
            `features.code_mode=${mode.startsWith("code")}`,
            `features.memories=false`,
            `features.chronicle=false`,
            `features.shell_snapshot=false`,
        ];
        let stdout = "", stderr = "";
        const child = spawn("codex", [
            "exec",
            "--ignore-user-config",
            "--dangerously-bypass-hook-trust",
            "--ignore-rules",
            "--ephemeral",
            "--skip-git-repo-check",
            "-C",
            workspace,
            "-s",
            "read-only",
            "--json",
            ...flags.flatMap((v) => ["-c", v]),
            "Run the synthetic fixture tool once, then finish.",
        ], { stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", (d) => {
            stdout += d;
        });
        child.stderr.on("data", (d) => {
            stderr += d;
        });
        const timer = setTimeout(() => child.kill("SIGTERM"), 60000);
        let exitCode = null;
        try {
            exitCode = await new Promise((resolve, reject) => {
                child.once("error", reject);
                child.once("close", resolve);
            });
        }
        finally {
            clearTimeout(timer);
            api.closeAllConnections();
            await new Promise((resolve) => api.close(() => resolve()));
        }
        const logDir = path.join(workspace, "data/metrics");
        const metrics = [];
        try {
            for (const file of await fs.readdir(logDir))
                for (const line of (await fs.readFile(path.join(logDir, file), "utf8"))
                    .split("\n")
                    .filter(Boolean))
                    metrics.push(JSON.parse(line));
        }
        catch { }
        results.push({
            mode,
            exitCode,
            calls,
            sawRaw,
            sawKept,
            sawFeedback,
            scenarioError,
            toolNames,
            metrics,
            outputPreview: JSON.stringify(capturedOutput)?.slice(0, 1500),
            diagnostic: stderr.slice(-1500),
            events: stdout.slice(-1500),
        });
    }));
    const report = {
        timestamp: new Date().toISOString(),
        codex: execFileSync("codex", ["--version"], { encoding: "utf8" }).trim(),
        scope: "Real CLI, synthetic model, production AlphaOptimizer MCP hook; no paid inference or user data",
        results,
    };
    await fs.writeFile(path.join(root, "docs/automatic-hook-probe.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(results.map(({ mode, exitCode, calls, sawRaw, sawKept, sawFeedback, scenarioError, metrics, }) => ({
        mode,
        exitCode,
        calls,
        sawRaw,
        sawKept,
        sawFeedback,
        scenarioError,
        metrics,
    })), null, 2));
    if (results.some((r) => r.exitCode !== 0 ||
        r.calls !== 2 ||
        !r.sawKept ||
        (r.mode === "code" || r.mode === "baseline" || r.mode === "shell"
            ? !r.sawRaw || r.sawFeedback
            : r.sawRaw || !r.sawFeedback)))
        process.exitCode = 1;
}
finally {
    await fs.rm(temporary, { recursive: true, force: true });
}
function toToml(value) {
    if (Array.isArray(value))
        return `[${value.map(toToml).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value)
            .map(([k, v]) => `${JSON.stringify(k)}=${toToml(v)}`)
            .join(",")}}`;
    return JSON.stringify(value);
}
