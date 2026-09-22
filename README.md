# AlphaOptimizer

AlphaOptimizer is an open-source tool from AlphaTales that helps Codex work with large command and
tool outputs. Instead of sending a huge log or search result straight into the context window,
AlphaOptimizer keeps the useful parts visible, keeps the original output available for a limited
time, and uses Jev to help rank what matters when an API key is configured.

## Observed Results

In initial AlphaTales tests, AlphaOptimizer reduced large tool-output payloads by about 60-65% on
average, with many runs sitting around 65%. The smallest reductions we saw were around 45%, and the
largest reached about 80%.

Actual results depend on the shape of the output and the task. These figures describe observed
context-payload reduction for eligible large outputs, not guaranteed billing savings.

## How It Works

Codex often runs commands that produce far more text than it needs: test logs, build errors,
repository searches, generated reports, or long tool responses. Large outputs can bury the useful
lines and waste context. AlphaOptimizer sits between those outputs and Codex.

```mermaid
flowchart LR
  A[Command or tool output] --> B{Should AlphaOptimizer process it?}
  B -- No --> C[Return original output]
  B -- Yes --> E[Split output into chunks]
  E --> H[Jev ranks relevant chunks]
  H --> D[Store full output locally with limits]
  H --> J[Compact result for Codex]
  J --> K[Codex can request more by artifact ID]
  D --> L[Expiry and quota cleanup]
```

The process is:

1. A command or tool returns text.
2. AlphaOptimizer checks whether the output is worth processing.
3. Small outputs, failed outputs, structured data, media, unsupported results, and secret-looking
   content pass through unchanged.
4. The text is split into chunks so it can be searched and selected.
5. Obvious diagnostics such as failures, expected/actual values, and important matches are preserved.
6. AlphaOptimizer sends a small bounded set of normal, non-sensitive chunks to Jev for relevance
   ranking.
7. After Jev responds, the full supported output is stored in a private local data folder.
8. Codex receives a shorter result with selected lines and an artifact ID.
9. If Codex needs more detail, it can read from the stored original output using that artifact ID.
10. Stored output expires or is evicted by the configured cleanup rules.

Jev is used when `ALPHAOPTIMIZER_JEV_API_KEY` is provided.

## Installation

```sh
npm install
npm run build
node dist/src/server.js
```

AlphaOptimizer requires Node `>=22 <23`.

## Configuration

By default, AlphaOptimizer works as a global Codex plugin across any project directory. It still
records the canonical workspace path with each stored output so later reads stay tied to the correct
workspace and session.

Common options:

- `ALPHAOPTIMIZER_MODE`: `off`, `observe`, or `filter`.
- `ALPHAOPTIMIZER_RETENTION_DAYS`: how long stored outputs are kept. Default: `14`.
- `ALPHAOPTIMIZER_MAX_STORE_BYTES`: local storage budget. Default: `268435456`.
- `ALPHAOPTIMIZER_METRICS_ENABLED`: set to `false` to disable local metrics.

To disable capture and selection completely:

```sh
ALPHAOPTIMIZER_MODE=off
```

To connect Jev:

```sh
ALPHAOPTIMIZER_JEV_API_KEY=your-key
```

See [Jev provider details](docs/provider-jev.md) before enabling it.

## Privacy

AlphaOptimizer is designed as a local trusted-process tool.

By default:

- Full processed outputs are stored locally under `~/.local/share/alphaoptimizer`.
- The data folder must be private to the current user. On Windows,
  AlphaOptimizer hardens it with NTFS permissions for the current user,
  `SYSTEM`, and local Administrators.
- Stored outputs expire after 14 days.
- The total store budget defaults to 256 MiB.
- Old unprotected outputs are evicted when the store needs space.
- Expired outputs are cleaned on startup, before capture, and during regular sweeps.

Jev is used when `ALPHAOPTIMIZER_JEV_API_KEY` is configured. AlphaOptimizer sends only bounded
candidate chunks labelled `normal`; sensitive and secret outputs are not sent to Jev.

## Implemented Safeguards

- Secret-looking outputs are skipped before capture.
- Outputs marked `secret` are not captured.
- Oversized artifacts pass through unchanged.
- Repository search uses workspace checks and avoids symlinks and sensitive paths by default.
- Local storage has retention and quota limits.
- AlphaOptimizer does not approve permissions or suppress destructive actions.
- AlphaOptimizer does not claim actual Codex billing savings; metrics are payload estimates only.

## License

AlphaOptimizer is released under the [MIT License](LICENSE).

Copyright (c) 2026 AlphaTales. Created by Libin Joseph.

## Portable MCP Installation

The shipped `.mcp.json` runs the installed `alphaoptimizer` executable. Install the package into a
bin directory on the Codex process's `PATH` before enabling its MCP server:

```sh
npm pack
npm install --global ./alphaoptimizer-0.1.0.tgz
```

For a private/local npm installation, add that installation's `node_modules/.bin` to the launcher's
`PATH`.

## Development

```sh
npm install
npm test
npm run typecheck
npm run typecheck:tests
npm run build
npm run test:package
```

## Metrics

Metrics are enabled by default. They record request counts, timing, estimated before/after payload
size, fallback reasons, and Jev usage when available.

Metrics do **not** measure actual Codex billing or total token savings. They are local estimates.

```sh
npm run metrics
npm run metrics -- --recent
```

See [metrics details](docs/metrics.md).
