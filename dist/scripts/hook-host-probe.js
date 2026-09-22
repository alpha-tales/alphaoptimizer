/** Exercise the real Codex CLI against a synthetic local Responses server; no paid model or workspace data. */
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-hook-host-"));
const original = "ALPHA_RAW_SENTINEL_70912";
const replacement = "ALPHA_REPLACED_SENTINEL_84623";
const results = [];
try {
    for (const mode of ["updatedMCPToolOutput", "continueFalse"]) {
        const managed = path.join(dir, mode);
        await fs.mkdir(managed);
        const receipt = path.join(managed, "receipt.json");
        const hook = path.join(managed, "hook.cjs");
        await fs.writeFile(hook, `const fs=require('node:fs'); let input=''; process.stdin.on('data',x=>input+=x); process.stdin.on('end',()=>{ const event=JSON.parse(input); fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({event:event.hook_event_name, tool:event.tool_name, response:event.tool_response, input:event.tool_input, sawOriginal:JSON.stringify(event.tool_response).includes(${JSON.stringify(original)})})); console.log(JSON.stringify(${JSON.stringify(mode === "continueFalse" ? { continue: false, stopReason: replacement } : { hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: { content: [{ type: "text", text: replacement }] } } })})); });`);
        await fs.writeFile(path.join(managed, "hooks.json"), JSON.stringify({
            hooks: {
                PostToolUse: [
                    {
                        matcher: "*",
                        hooks: [
                            {
                                type: "command",
                                command: `'${process.execPath}' '${hook}'`,
                                timeout: 5,
                            },
                        ],
                    },
                ],
            },
        }));
        let calls = 0;
        let sawOriginal = false;
        let sawReplacement = false;
        let toolName = "";
        const server = http.createServer(async (req, res) => {
            let body = "";
            for await (const chunk of req)
                body += chunk;
            try {
                const request = JSON.parse(body);
                calls++;
                const content = JSON.stringify((request.input ?? []).filter((item) => item.type === "function_call_output"));
                if (calls > 1) {
                    sawOriginal ||= content.includes(original);
                    sawReplacement ||= content.includes(replacement);
                }
                let output;
                if (calls === 1) {
                    const names = (request.tools ?? []).map((tool) => tool.name);
                    toolName = names.includes("exec_command")
                        ? "exec_command"
                        : names.includes("shell_command")
                            ? "shell_command"
                            : "shell";
                    const args = toolName === "exec_command"
                        ? { cmd: `/usr/bin/printf ${original}`, max_output_tokens: 100 }
                        : toolName === "shell_command"
                            ? { command: `/usr/bin/printf ${original}` }
                            : { command: ["/usr/bin/printf", original] };
                    output = {
                        type: "function_call",
                        id: "fc_probe",
                        call_id: "call_probe",
                        name: toolName,
                        arguments: JSON.stringify(args),
                        status: "completed",
                    };
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
                                text: "Synthetic host probe complete.",
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
                    { type: "response.output_item.added", output_index: 0, item: output },
                    { type: "response.output_item.done", output_index: 0, item: output },
                    { type: "response.completed", response },
                ])
                    res.write(`data: ${JSON.stringify(event)}\n\n`);
                res.end();
            }
            catch {
                res.writeHead(500);
                res.end();
            }
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const port = server.address().port;
        const configs = [
            `model_provider="probe"`,
            `model="probe"`,
            `model_providers.probe={name="probe",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`,
            `hooks.PostToolUse=[{matcher="*",hooks=[{type="command",command=${JSON.stringify(`'${process.execPath}' '${hook}'`)},timeout=5}]}]`,
            `features.code_mode_host=false`,
            `features.code_mode=false`,
            `features.memories=false`,
            `features.chronicle=false`,
            `features.shell_snapshot=false`,
        ];
        let stderr = "";
        let stdout = "";
        const child = spawn("codex", [
            "exec",
            "--ignore-user-config",
            "--dangerously-bypass-hook-trust",
            "--ignore-rules",
            "--ephemeral",
            "--skip-git-repo-check",
            "-C",
            dir,
            "-s",
            "read-only",
            "--json",
            ...configs.flatMap((config) => ["-c", config]),
            "Run the synthetic host probe tool once, then finish.",
        ], { stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", (data) => (stdout += data));
        child.stderr.on("data", (data) => (stderr += data));
        const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
        const exitCode = await new Promise((resolve, reject) => {
            child.on("error", reject);
            child.on("close", resolve);
        });
        clearTimeout(timer);
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
        let hookReceipt = null;
        try {
            hookReceipt = JSON.parse(await fs.readFile(receipt, "utf8"));
        }
        catch { }
        results.push({
            mode,
            exitCode,
            calls,
            toolName,
            hookReceipt,
            modelRequestSawOriginal: sawOriginal,
            modelRequestSawReplacement: sawReplacement,
            diagnostic: stderr.slice(-3000),
            events: stdout.slice(-3000),
        });
    }
    const report = {
        timestamp: new Date().toISOString(),
        codex: execFileSync("codex", ["--version"], { encoding: "utf8" }).trim(),
        scope: "Real CLI hooks with synthetic local model transport; not desktop or production model validation",
        results,
    };
    await fs.writeFile(path.resolve("docs/hook-host-probe.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    const probes = results;
    if (probes.some((probe) => probe.exitCode !== 0 || !probe.hookReceipt) ||
        !probes[0].modelRequestSawOriginal ||
        probes[0].modelRequestSawReplacement ||
        probes[1].modelRequestSawOriginal ||
        !probes[1].modelRequestSawReplacement)
        process.exitCode = 1;
}
finally {
    await fs.rm(dir, { recursive: true, force: true });
}
