# Local request metrics

The MCP server logs numeric metadata for evidence selection, `select_evidence` responses,
`read_artifact` calls, and repository searches. Hook-driven selection is distinguished by source.
It does not automatically observe ordinary Codex calls that never use AlphaOptimizer. Criterion
registration/listing and schema rejections before a tool handler runs are not instrumented.

With the optional [automatic integration](automatic-use.md), the host invokes the processor for
supported lifecycle events without an explicit user request. `automaticHooks` records those
inspections, skip reasons and replacement requests separately. Requested reductions are not
delivery receipts. Native code-mode behavior and its emission policy have different guarantees.

## View results

From the AlphaOptimizer project folder, after building:

```sh
npm run metrics
npm run metrics -- --recent
```

The second command includes the ten most recent retained metric records. For a custom store,
set `ALPHAOPTIMIZER_DATA_DIR` to the same directory as the MCP server. The report command reads
its environment, not Codex's TOML configuration. It can also be run directly from the installed
package's `dist/src/telemetry/report.js`.

Logs are JSONL files under `~/.local/share/alphaoptimizer/metrics/` by default. The directory is
private and files are created with mode 0600. The report tolerates partial lines and files rotating
during a read, and discloses skipped records/files. It does not need or read the Jev API key.

## What the numbers mean

| Field | Meaning |
|---|---|
| Input/output token estimates | `ceil(text.length / 4)` using JavaScript UTF-16 length, not a model tokenizer |
| Payload reduction | Original payload estimate minus rendered selection estimate; can be negative |
| Payload reduction percent | Weighted reduction across successful selections in the group; null for zero input |
| Tool response estimate | Entire MCP text content, including serialized metadata; excludes protocol framing and tool input |
| Duration | Local handler/engine elapsed time, excluding the asynchronous disk flush |
| Provider duration | Classification stage duration, including preparation, validation, and waiting |
| Provider attempted | An outbound fetch was invoked; this does not establish receipt or billing |
| Provider token usage | Validated usage reported by Jev; null if unavailable |
| Fallback | Fixed category for capture, size, privacy, disabled, overflow, durability, or provider failure |
| Artifact ID | Opaque reference for correlating retrievals with selections; no raw artifact content |

Selection and MCP response records share a request ID for `select_evidence`. Retrievals have
their own request ID and the artifact ID they expand. Selection and response records are two
stages of the same call: do not add them as independent requests. Failed/cancelled selection and
tool counts are shown separately. Hook selection estimates describe internal processing,
not proof that the host replaced its original output.

The report separates source, mode, and provider status. Network failures or responses without
validated usage remain unknown. Usage can be known even if later candidate-ID validation fails.
No price is hard-coded and no dollar savings are claimed.

**A shorter selection is not measured Codex savings.** If Codex already consumed the original
output, its input cost has already occurred. Whole-task comparisons also need subsequent reads,
tool-call input, model output, cached input, and host-reported usage. Actual before/after savings
require equivalent tasks run without optimization, with deterministic selection, and with Jev.

## Bounded, best-effort writes

- Enabled by default in the MCP server. Set `ALPHAOPTIMIZER_METRICS_ENABLED=false` and restart
  to disable. This setting is independent of selection mode and does not change Jev configuration.
  Direct engine consumers must explicitly supply a metrics sink.
- The request path validates and enqueues a small record. It never awaits a file write.
- Queue capacity is 256 records, plus at most 32 in an active batch; each record is capped at
  2 KiB. Overflow drops metrics rather than delaying evidence processing.
- Flush starts about once per second while records are queued; each write batches up to 32 records.
- Each process writes a randomly named file. Rotation keeps current and previous files, each at
  most 1 MiB. Shared cleanup targets seven days, 32 files, and 16 MiB across processes. Cleanup
  runs during writes, not as a standalone scheduler; concurrent writers can briefly exceed the
  shared target. Metrics have a separate allowance from the evidence-store quota.
- Disk failures drop the batch, increment counters, and emit one generic stderr warning per
  process. Exception contents and source strings are not copied into metrics.
- Signals, connection closure, and stdin EOF attempt a flush with a one-second deadline.
  A crash or forced kill can lose buffered records; pending disk work may not finish.
- Drop counters appear on subsequently accepted records and are lower bounds. Rotation, expiry,
  a failed final flush, or an idle process after overflow can make retained history incomplete.

Logs exclude prompts, output text, queries, filenames/workspace paths, session labels, commands,
provider response bodies, and credentials. Schemas allow only fixed status values, timestamps,
generated request IDs, opaque artifact IDs, and numeric measurements.

## Validation and overhead

Tests cover slow/hung/failed writes, queue overflow, private files, rotation, partial records,
independent writers, provider success/fallback, cancellation, a throwing sink, and real MCP calls
with logging enabled/disabled and disconnect flushing. No live provider request is needed.

A local synthetic comparison on 21 September 2026 alternated logging on/off against the same
store. After 20 warmup calls, 50 calls per mode gave median 4.356 ms off versus 4.483 ms on;
p95 was 7.098 ms versus 7.148 ms. All 60 enqueued records were written without drops. This
measures the buffered path on that workload, not a guarantee for every device or a benchmark
of concurrent disk flushing, provider latency, or real Codex task savings.
