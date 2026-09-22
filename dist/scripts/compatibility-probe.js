import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
function tryCommand(command, args) {
    try {
        return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    }
    catch (error) {
        return `unavailable: ${error.message}`;
    }
}
const report = `# AlphaOptimizer Compatibility Notes

Generated: ${new Date().toISOString()}

## Local Versions

- Node: ${process.version}
- npm: ${tryCommand("npm", ["-v"])}
- Codex CLI: ${tryCommand("codex", ["--version"])}

## Hook Status

This probe records local versions only. Model-visible replacement, capture-before-truncation,
streaming behavior, desktop hook composition, and server-not-ready behavior still require a
manual disposable-workspace test because the current public CLI surface does not expose a
model-observation trace from this script.

## Current Support Matrix

| Capability | Status | Evidence |
|---|---|---|
| MCP stdio server starts | supported | TypeScript build and MCP SDK wiring |
| Durable artifact capture | supported | Local SQLite/artifact tests |
| Transparent post-tool replacement | unknown | Needs host trace |
| Capture before host truncation | unknown | Needs host trace |
| Jev reranking | disabled | Provider contract unverified |
`;
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(path.join("docs", "local-versions.md"), report);
console.log(report);
