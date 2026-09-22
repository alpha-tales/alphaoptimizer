# Automatic tool-output processing

Automatic processing is opt-in. It uses the connected AlphaOptimizer MCP server and does not
require writing commands around the user's tools, changing permissions, or typing the plugin name
in every request.

## Enable or disable

From this checkout, with AlphaOptimizer already registered in Codex:

```sh
npm run build
npm run compat:auto
npm run hooks:enable
```

Restart Codex afterward. The installer preserves other hook groups and their indices, registers
one `PostToolUse` MCP hook in the user's `hooks.json`, and trusts only its exact definition hash
through Codex's normal configuration API. It sets `ALPHAOPTIMIZER_AUTO_MODE=filter` on the existing
MCP server. Credentials, ordinary approval policy, sandbox settings, and other hooks are untouched.

The installer also adds a marked section to the user's `AGENTS.md` for code-mode output emission.
It updates that section idempotently and preserves surrounding instructions. The generated section
is maintained in `src/hooks/policy.ts`.

To remove only AlphaOptimizer's automatic integration:

```sh
npm run hooks:disable
```

Restart Codex. The MCP tools remain installed and available explicitly. A disabled empty hook
slot may remain to preserve the indices and trust keys of unrelated handlers.

## Actual host coverage

The real CLI probe runs against a local synthetic Responses endpoint with the production MCP
server. It does not send workspace content to a paid model or Jev. Saved evidence is in
`automatic-hook-probe.json`; the tested CLI version is recorded there.

| Path | Behavior established by the probe |
|---|---|
| Native text-only MCP result | Eligible output is replaced; omitted sentinel disappears from the next model request and the diagnostic sentinel remains |
| Native shell result | This host supplies stdout without exit status, so it passes through; status must not be lost |
| Code-mode with only the native hook | Raw JavaScript return value remains intact; native feedback alone does not reduce printed output |
| Code-mode emission through `process_tool_result` before `text()` | Filtered output reaches the model while the script retains its original result and exit code |
| Automatic mode off | Original output remains visible |

The code-mode policy directs the assistant to call the processor before emitting a large result,
inside the same script. It is an instruction-based integration, not a host-enforced rewrite of
every possible script. A script that prints the original first has already exposed it. The probe
proves the emission path works, not that every production model will follow the instructions.

The native hook uses `continue: false` and `stopReason` only for tested eligible text. It does not
return `decision: block`, reject the original tool promise, use `updatedMCPToolOutput`, or inject
source text through `additionalContext`. Excerpts remain quoted tool-result data. Hook feedback
may appear as a stopped hook in host diagnostics; that is distinct from stopping the task.

Desktop native-hook delivery has not been separately exercised. Existing hosted web search and
other tools outside the host's local hook path are not intercepted. Missing/unready MCP connections,
untrusted hook changes, and host errors leave normal tool behavior intact.

## Selection and safety policy

- Inspect all events delivered to the installed hook, but process only shell/text-only MCP results.
- Skip AlphaOptimizer's own calls to prevent recursive processing.
- Skip small outputs (below the lesser of 1,500 estimated tokens and the configured threshold).
- Preserve images, resource links, structured JSON/MCP data, errors, running processes, and
  recognizable truncated results. Unknown or malformed shapes pass through.
- Shell filtering requires an actual numeric exit code supplied from the original result, and only
  exit code zero is eligible. Missing status and failed commands remain unchanged.
- Skip known credential-related tools, commands, and secret-like output before storing it. Pattern
  detection is conservative but not a universal secret detector; automatic processing stays local.
- By default, the hook accepts any real cwd so the plugin works globally across Codex projects.
  If `ALPHAOPTIMIZER_WORKSPACES` is set, the hook accepts only those roots and their descendants.
- Store exactly the text visible to the hook. Do not call it complete process output: the host may
  already have limited it. Record capture completeness as unavailable and provide a recovery handle.
- Use an 800-token maximum selection target, preserve mandatory diagnostics, and pass through
  on mandatory overflow, storage failure, cancellation, oversized feedback, or insufficient reduction.
- Replace only when the complete feedback is at least 15% smaller and below 8,000 characters.
  Original available status and raw-retrieval arguments are included in the feedback.
- The registered hook timeout is five seconds; the server fails open on processing errors.

Automatic processing uses Jev when `ALPHAOPTIMIZER_JEV_API_KEY` is configured and the output is
eligible. If Jev is unavailable, disabled, or not configured, automatic processing leaves the
original output unchanged.

## Logs

```sh
npm run metrics
npm run metrics -- --recent
```

`automaticHooks` reports inspections, pass-through reasons, replacement requests, errors, and
latency. Its estimated reduction describes requested replacement payloads, **not confirmed host
delivery or whole-task savings**. Host timeouts, other hooks, and code-mode scripts can affect delivery.
Selections made by the processor have source `hook`. Metrics exclude raw commands, output, and keys.

Use the host probe to verify delivery behavior after a Codex upgrade. Use paired real tasks and
host-reported usage to measure actual savings. Jev availability and latency depend on the configured
provider account and network.
