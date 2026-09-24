# Host compatibility

Validated 21 September 2026 with `codex-cli 0.149.0`.

`npm run compat:hooks` runs the real CLI in a disposable workspace against a synthetic local Responses
server. It installs an invocation-only PostToolUse hook, runs a portable Node text emitter, and inspects the
next model request's tool-output messages. It does not change user hook files. The command uses
`--ignore-user-config` and the documented invocation-only trust bypass for its generated hook. It may
still perform the CLI's normal model-metadata refresh. No real model inference or provider content
sharing is needed.

Saved receipt: [hook-host-probe.json](hook-host-probe.json).

| Probe | Hook ran and saw original | Next model request |
| --- | --- | --- |
| `updatedMCPToolOutput` on Bash output | Yes | Original marker present; replacement absent |
| `continue: false` with a fixed stop reason | Yes | Replacement marker present; original absent |

This establishes CLI PostToolUse execution and feedback substitution for Bash. It does **not** establish
MCP result replacement, desktop behavior, code-mode equivalence, streaming capture, capture before
truncation, or plugin installation compatibility. The mock transport verifies what the host sends;
it does not test whether a production model follows the substituted content.

The [official contract](https://learn.chatgpt.com/docs/hooks) documents `updatedMCPToolOutput` as
unsupported. `continue: false` is a control-flow/feedback feature, not ordinary transparent output
replacement. AlphaOptimizer does not turn arbitrary evidence into hook feedback or trusted developer
instructions. `handle_hook` remains capture/advisory and always returns `pass_through`; use the
`select_evidence` MCP tool to receive optimized evidence. Plugin packages now include native lifecycle hooks; Codex still requires hook trust.

The separate `npm run compat` command records local version information only in
`docs/local-versions.md`; it cannot overwrite this host-validation report.

## Automatic integration update

The table above describes the original low-level control-flow experiment. The new
`npm run compat:auto` test exercises the production `process_tool_result` MCP handler on native MCP,
shell, and code-mode paths. See [automatic-use.md](automatic-use.md) and
[automatic-hook-probe.json](automatic-hook-probe.json) for the supported behavior and limits.
The legacy `handle_hook` remains advisory; bundled plugin hooks use the new processor and a
session code-mode emission policy. It does not enable replacement for paths missing status or
requiring preservation of structured output. No evidence is injected as developer context.
