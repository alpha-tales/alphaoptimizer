# AlphaOptimizer Operations

AlphaOptimizer is a local MCP tool for preserving raw tool output while returning smaller,
cited evidence selections. New installations default to observation behavior through
`ALPHAOPTIMIZER_MODE=observe`; set `off` to disable capture and selection entirely. Use `filter`
only after host compatibility is proven.

## Run Locally

```bash
npm install
npm run build
npm run dev
```

Runtime data is stored under `~/.local/share/alphaoptimizer` by default. Override with
`ALPHAOPTIMIZER_DATA_DIR`. Data, artifact, and metrics directories must be private to the current user.
On Windows, AlphaOptimizer removes inherited permissions and grants access only to
the current user, `SYSTEM`, and local Administrators for each managed directory using the built-in
`whoami` and `icacls` commands. If that hardening fails, it does not capture output.
Expired artifacts are removed on server startup from raw files, SQLite metadata, chunks, and FTS
entries. This is normal deletion, not forensic erasure of historical disk blocks or SQLite/WAL
remnants.

## Important Environment Variables

- `ALPHAOPTIMIZER_MODE`: `off`, `observe`, or `filter`.
- `ALPHAOPTIMIZER_SESSION_ID`: optional stable server-bound session ID. If unset, each server
  process creates a fresh local session.
- `ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS`: minimum output size before selection is attempted.
- `ALPHAOPTIMIZER_SELECTION_TOKEN_BUDGET`: approximate selected-output budget.
- `ALPHAOPTIMIZER_JEV_API_KEY`: enables Jev relevance ranking.

## Removal

Stop the MCP server, remove this plugin from Codex configuration, then delete the runtime data
directory if raw artifact retention is no longer needed.

## Aggregate disk policy

`ALPHAOPTIMIZER_MAX_STORE_BYTES` defaults to 268435456 (256 MiB), minimum 1 MiB.
`ALPHAOPTIMIZER_QUOTA_POLICY` is `oldest_unprotected` (default) or `reject`.

The budget is conservative and partitioned: one third for raw files and transactional headroom,
one third for SQLite (less 64 KiB reserve), and one third for its rollback journal. Live raw evidence
is capped at one twelfth of the total (about 21.3 MiB at the default); the rest accommodates duplicate
chunk/FTS text, rollback and eviction recovery. SQLite page limits bound metadata, criteria and indexes,
too. Index overhead can exhaust its partition before the raw quota; capture then rolls back and the
engine preserves original output. This is a bound on managed file lengths, not filesystem block
allocation, backups, external files, or forensic remnants. Existing oversized databases must be given
a larger budget before opening. Use the same quota configuration for every process sharing a store.

Oldest creation time wins; artifact ID breaks ties. Artifacts with pinned chunks or criterion references
(to either artifact or chunk IDs) cannot be evicted for quota. If only protected evidence remains,
new capture fails safely. Retention expiry still applies to protected evidence: pinning is not indefinite
retention. Expiry runs at startup, before capture, and every 60 seconds while the server runs.

Capture, quota admission and indexing share a SQLite immediate transaction. Evicted files are renamed
until commit, then reclaimed under the write lock; recovery restores files after rollback and removes
orphaned files after interrupted capture. SQLite uses DELETE journaling rather than WAL to keep the
journal bounded. Database free pages are reused; deletion does not promise the database file shrinks.

## Repository search bounds

Search uses asynchronous ripgrep and file reads, propagates MCP cancellation, limits subprocesses to
two seconds and the full search to ten seconds. Lexical fallback uses at most four readers, 2,000 files
and 32 MiB of source data. Overflow produces an explicit error so incomplete scans cannot look complete.
Both paths apply the same exclusions and ignore rules. Hashes use the exact buffer used for excerpts.

## Jev

See [provider setup](provider-jev.md). It is enabled when `ALPHAOPTIMIZER_JEV_API_KEY` is configured.

## Request protection and retrieval lifetime

Engine captures create a durable five-minute protection lease in the same transaction as the artifact.
Quota eviction and expiry sweeps honor leases across processes. Once response construction completes,
the lease becomes a five-minute retrieval grace period. After that window, normal quota/retention
rules apply; pinned or criterion-linked evidence has its separate protection. A process crash leaves
only a bounded lease, reclaimed by the next sweep. No database transaction spans provider I/O.
Before returning a handle, the engine checks and extends the lease atomically; lost evidence returns
original text without a handle. Provider calls and cooperative selection honor caller cancellation.

## Artifact search continuation

`read_artifact` with `query` now performs case-insensitive **literal substring** search, rather than
FTS token-query matching. It returns windows containing the entire match and bounded surrounding
context. `maxBytes` caps the combined UTF-8 text, with at most 50 windows per page. A budget smaller
than the match returns an explicit error. Offsets and line numbers describe the returned window.

Pass the same artifact ID and query plus `cursor: search.nextCursor` to continue. Cursors are tied to
the artifact hash and query. `hasMore`/`nextCursor` concern remaining matches, not omitted nonmatching
context. Each window's `partial` flag identifies excerpted chunks; `omittedChunks` counts matching
chunks not returned in full on that page. Use byte-range retrieval to expand nonmatching context.

Repository exact hits are checked against ripgrep's original matching line before applying its line
number to the new snapshot. Changed lines produce a retry error, never an unrelated exact-hit excerpt.

Diagnostics are pinned from recognized failure/expected/actual markers through the record boundary
(blank line or explicit passing/summary line). Unknown continuations are retained conservatively.
Chunks do not overlap and are bounded to 4096 per artifact; legacy overlap is deduplicated on render.
Selection uses precomputed block costs, incremental framing costs, one candidate sort, and cooperative
yields every 128 candidates. Mandatory evidence can exceed the requested budget with an explicit reason.

Search windows are now built from one hash-verified raw artifact snapshot, so literal queries may span
storage chunks and newlines. A returned `chunkId` identifies the window; `sourceChunkIds` lists the
indexed chunks overlapped by that window. Its `partial` flag means the window is not the entire raw
artifact. The 1024-byte context target expands for a larger complete match, up to the caller's remaining
`maxBytes`; valid Unicode queries are not subject to an extra per-window byte ceiling. UTF-8 decoding
preserves U+FEFF, including at the beginning of context. Offsets always refer to the original raw bytes.

Search cursors use version 2 with an artifact-wide character position, bound to the artifact hash and
query. Version 1 chunk-relative cursors are explicitly rejected; restart those searches without a cursor.

## Metrics

Run `npm run metrics` for the retained request summary, or `npm run metrics -- --recent` to
include recent records. Metrics are enabled by default; set `ALPHAOPTIMIZER_METRICS_ENABLED=false`
in the MCP environment to opt out. Restart the MCP server after updating its build or environment.
See [metrics](metrics.md) for privacy, batching, retention, measurement limits, and validation.
