# AlphaOptimizer

AlphaOptimizer is a local Codex MCP prototype for large textual tool results. It stores raw
evidence locally, returns concise deterministic excerpts, supports bounded artifact expansion, and
searches repository evidence with workspace checks.

## Current Status

Implemented:

- MCP tools for `select_evidence`, `read_artifact`, `search_repository`, `record_criterion`,
  `check_completion`, and `handle_hook`.
- Local SQLite metadata plus private artifact files.
- Deterministic selection that preserves pinned failure evidence before optional excerpts.
- Workspace/session-scoped artifact reads.
- Repository search that uses `rg` first and avoids symlinks and sensitive paths by default.

Not yet supported as proven production behavior:

- Blanket replacement across every Codex tool/runtime. Supported automatic paths are described below.
- Live Jev accuracy, latency, and billing validation (optional integration is implemented).
- Permission decisions, destructive-action suppression, or cost-savings claims.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/src/server.js
```

The package requires Node `>=22 <23`.

## Configuration

By default, the server allows only the directory it starts in and uses a generated process-local
session ID. Configure a stable project/session scope with:

```bash
ALPHAOPTIMIZER_WORKSPACES="/path/to/project" ALPHAOPTIMIZER_SESSION_ID="project-session" node dist/src/server.js
```

Use `ALPHAOPTIMIZER_MODE=off` to disable capture and selection. Runtime data defaults to
`~/.local/share/alphaoptimizer` and must be private to the current user.

## Privacy

This is a local trusted-process tool. It stores text artifacts and chunks on disk. Do not enable
external providers or filter mode until the relevant compatibility and data-sharing checks are
complete.

## Implemented safeguards

Repository search is asynchronous and cancellable. Storage has a configurable aggregate budget,
oldest-first eviction, and protected-evidence rules. Optional Jev reranking requires explicit data-sharing
and terms opt-ins and preserves deterministic fallback. See [operations](docs/operations.md),
[provider details](docs/provider-jev.md), and the [real CLI hook probe](docs/compatibility.md).

## License

AlphaOptimizer is released under the [MIT License](LICENSE).

Copyright (c) 2026 AlphaTales. Created by Libin Joseph.

## Portable MCP installation

The shipped `.mcp.json` runs the installed `alphaoptimizer` executable. Install the package into a
bin directory on the Codex process's `PATH` before enabling its MCP server:

```sh
npm pack
npm install --global ./alphaoptimizer-0.1.0.tgz
```

For a private/local npm installation, add that installation's `node_modules/.bin` to the launcher's
`PATH`. No checkout path belongs in the published configuration. `npm run test:package` packs and
installs into a temporary directory, then launches the shipped command from an unrelated project.

## Request metrics

Metrics logging is enabled by default for the MCP server. After rebuilding, restart Codex so its
server process loads the new version. Inspect retained local metrics from the project folder:

```sh
npm run metrics
npm run metrics -- --recent
```

The report shows before/after payload token estimates, Jev usage when reported by the provider,
latency, fallbacks, errors, and artifact retrieval calls. It does **not** measure actual Codex
token or billing savings. Metrics contain numbers, fixed status codes, and opaque IDs—not source
text, goals, commands, paths, or API keys. Set `ALPHAOPTIMIZER_METRICS_ENABLED=false` in the MCP
environment to disable logging. See [metrics details](docs/metrics.md).

## Automatic use

After registering the MCP server, run `npm run compat:auto` and `npm run hooks:enable`, then restart
Codex. This installs a global PostToolUse hook plus a code-mode output policy, so eligible results
can be processed without naming AlphaOptimizer in each prompt. Small, sensitive, structured,
streaming, failed, and unsupported results pass through. Automatic selection stays local by default.

Native shell hooks on the tested host lack exit status and therefore pass through; code-mode
processing preserves the original exit code. Code-mode use is instruction-driven, not a guaranteed
rewrite of every script. See [automatic use and verified coverage](docs/automatic-use.md).
