# AlphaOptimizer

AlphaOptimizer helps Codex handle very large command and tool outputs without filling the context
window with noise.

When a tool returns a long log, test result, search output, or repository scan, AlphaOptimizer keeps
the important parts visible to Codex and keeps the full output available for a short, bounded time in
case Codex needs to inspect more of it.

## What It Does

- Accepts large text output from Codex tools, shell commands, or MCP tools.
- Skips small outputs, failed outputs, structured data, media, and secret-looking content.
- Stores the full text locally for limited retrieval.
- Selects the most useful lines for Codex to read immediately.
- Lets Codex read more from the stored output by artifact ID when needed.
- Can use Jev to help rank which parts of the output look most relevant.
- Falls back to deterministic local selection if Jev is disabled or unavailable.

In simple terms: **AlphaOptimizer reduces noise before it reaches Codex, while keeping the original
output close enough to verify.**

## How The Process Works

1. A command or tool returns a large text output.
2. AlphaOptimizer checks whether the output is safe and useful to process.
3. If it is too small, secret-looking, unsupported, or too large for the configured limit, it passes
   through unchanged.
4. Otherwise, AlphaOptimizer saves the full text in a private local data folder.
5. It splits the text into chunks.
6. It keeps obvious diagnostics such as failures, expected/actual values, and important matches.
7. If Jev is enabled, AlphaOptimizer sends a small bounded set of normal, non-sensitive candidate
   chunks to Jev for relevance ranking.
8. Codex receives a compact result with selected lines and an artifact ID for follow-up reads.
9. The stored full output expires or is evicted by the local cleanup rules.

## Jev

Jev support is optional and disabled by default.

When enabled, AlphaOptimizer uses Jev to help decide which optional chunks are most relevant to the
current goal. Jev does not receive outputs marked sensitive or secret. If Jev fails, times out, or is
not configured, AlphaOptimizer uses its local deterministic selector.

To enable Jev, set:

```sh
ALPHAOPTIMIZER_JEV_ENABLED=true
ALPHAOPTIMIZER_JEV_DATA_SHARING=true
ALPHAOPTIMIZER_JEV_TERMS_ACCEPTED=true
ALPHAOPTIMIZER_JEV_API_KEY=your-key
```

See [Jev provider details](docs/provider-jev.md) before enabling it.

## Local Storage And Cleanup

AlphaOptimizer stores processed text locally because Codex may need to inspect the full original
output after receiving the shorter result.

By default:

- Data is stored under `~/.local/share/alphaoptimizer`.
- The data folder must be private to the current user.
- Stored outputs expire after 14 days.
- The total store budget defaults to 256 MiB.
- Raw stored text is capped within that budget.
- Old unprotected outputs are evicted when the store needs space.
- Expired outputs are cleaned on startup, before capture, and during regular sweeps.

You can change the behavior:

```sh
ALPHAOPTIMIZER_RETENTION_DAYS=1
ALPHAOPTIMIZER_MAX_STORE_BYTES=67108864
ALPHAOPTIMIZER_MODE=off
```

Use `ALPHAOPTIMIZER_MODE=off` to disable capture and selection completely.

## Installation

```sh
npm install
npm run build
node dist/src/server.js
```

The package requires Node `>=22 <23`.

## MCP Configuration

The shipped `.mcp.json` runs the installed `alphaoptimizer` executable. Install the package into a
bin directory on the Codex process's `PATH` before enabling its MCP server:

```sh
npm pack
npm install --global ./alphaoptimizer-0.1.0.tgz
```

For a private/local npm installation, add that installation's `node_modules/.bin` to the launcher's
`PATH`.

## Configuration

By default, the server allows only the directory it starts in and uses a generated process-local
session ID. Configure a stable project/session scope with:

```sh
ALPHAOPTIMIZER_WORKSPACES="/path/to/project" ALPHAOPTIMIZER_SESSION_ID="project-session" node dist/src/server.js
```

Important options:

- `ALPHAOPTIMIZER_MODE`: `off`, `observe`, or `filter`.
- `ALPHAOPTIMIZER_WORKSPACES`: allowed workspace paths.
- `ALPHAOPTIMIZER_RETENTION_DAYS`: local output retention period.
- `ALPHAOPTIMIZER_MAX_STORE_BYTES`: local storage budget.
- `ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS`: minimum output size before selection.
- `ALPHAOPTIMIZER_SELECTION_TOKEN_BUDGET`: approximate selected-output budget.
- `ALPHAOPTIMIZER_METRICS_ENABLED`: set to `false` to disable local metrics.

## Metrics

Metrics are enabled by default. They record request counts, timing, estimated before/after payload
size, fallback reasons, and Jev usage when available.

Metrics do **not** measure actual Codex billing or total token savings. They are local estimates.

```sh
npm run metrics
npm run metrics -- --recent
```

See [metrics details](docs/metrics.md).

## Safety Notes

AlphaOptimizer is designed as a local trusted-process tool.

- It does not approve permissions.
- It does not suppress destructive actions.
- It does not guarantee cost savings.
- It does not claim Jev quality, latency, or billing behavior unless you verify those in your own
  environment.
- It avoids known secret-looking content, but pattern matching is not a perfect secret detector.

## Development

```sh
npm install
npm test
npm run typecheck
npm run typecheck:tests
npm run build
npm run test:package
```

## License

AlphaOptimizer is released under the [MIT License](LICENSE).

Copyright (c) 2026 AlphaTales. Created by Libin Joseph.
