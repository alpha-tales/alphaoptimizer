# AlphaOptimizer — third code review

Reviewed 21 September 2026. Current-tree review; no Git metadata exists. Application source was not edited. Build output was regenerated during verification.

**Verdict: substantial improvement, but request changes.** The earlier public-tool privacy and session issues are corrected. Six actionable findings remain below, including a newly reproduced concurrency defect in quota eviction.

## Findings

### 1. P1 — Quota eviction can invalidate an in-flight response

Locations: [optimizer.ts:136](/Users/libinjoseph/Projects/AlphaOptimizer/src/optimizer.ts:136), [evidenceStore.ts:241](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:241).

Capture commits an artifact before awaiting the optional provider. While that request is pending, another capture can evict its unpinned artifact. The first request subsequently returns success and a recovery handle for a deleted artifact. The eviction policy protects failure/criterion evidence but has no protection for currently executing requests.

**Reproduced:** With a 6 MiB store quota, an 8,000-byte normal observation waited on a synthetic provider response. A second 520,000-byte sensitive observation completed and evicted it. The first request then returned a non-null artifact; `getArtifact` for that ID returned null. No real provider call was made.

**Fix:** Acquire a durable in-flight protection lease in the capture transaction and release it after response construction, with bounded expiry for crashed processes. Keep active-task evidence according to an explicit lifetime policy. At minimum, verify existence before returning and fall back to original text if durability was lost; do not advertise an invalid expansion handle. Do not hold a SQLite write transaction open across the network call.

**Test:** Concurrent captures with the first provider response delayed and the store near capacity, plus a crashed lease owner and independent server processes.

### 2. P1 — Shipped MCP configuration hard-codes the author's computer path

Location: [.mcp.json:5](/Users/libinjoseph/Projects/AlphaOptimizer/.mcp.json:5).

The configuration now points to `/Users/libinjoseph/Projects/AlphaOptimizer/dist/src/server.js`. This fixes local cwd dependence by making the package specific to one machine. Other users cannot start it through this configuration, and another installation on the same computer may execute this checkout instead of its own version.

**Fix:** Use the host's supported installed-plugin-root resolution, or a correctly installed executable with a documented configuration. Keep developer-local overrides out of the published configuration.

**Test:** Pack and install into an unrelated directory, inspect the published config for local paths, then initialize the configured MCP server from a different project. Passing a separate manually constructed absolute path is not the same test.

### 3. P2 — Artifact search can omit the matching text and falsely report completion

Location: [evidenceStore.ts:589](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:589).

Matching chunks are truncated from their beginning, not around the search hit. When the hit lies later in a long chunk, the result contains none of the requested evidence. A partially returned chunk still counts as fully returned, so `omittedChunks` can be zero and `nextCursor` null. The separate chunk cursor is also not accepted by any search input, and the SQL `limit 50` can hide further results without reporting them. Truncated results retain the original chunk's end-line metadata.

**Reproduced:** Searching a single long line ending in `TARGET_NEEDLE` with a 100-byte budget returned 100 bytes that did not contain the term, `omittedChunks: 0`, and `nextCursor: null`.

**Fix:** Return bounded windows around matches, update their exact offsets and line ranges, and expose a usable continuation contract covering partial chunks and additional rows. Query one extra row or otherwise determine whether more results exist. Raw range retrieval remains available, but users should not need to distrust and reconstruct a purportedly complete search result.

**Tests:** Hit near the end of a long line, several hits within one chunk, more than 50 matching chunks, and continuation after a partial result.

### 4. P2 — Three-line overlap still loses diagnostic details

Location: [text.ts:24](/Users/libinjoseph/Projects/AlphaOptimizer/src/parsers/text.ts:24).

The previous line-40 fixture now passes because chunks overlap by three lines. This only moves the boundary. A failure header outside that overlap still does not pin expected/actual values in the following chunk. Those values can be discarded despite available budget.

**Reproduced:** A failure header at line 37, four intervening detail lines, and `Expected: 100` / `Received: 0` at lines 42–43. Selection kept the failure header but omitted both values at a 1,500-token budget.

**Fix:** Group complete failure records, or expand pinned ranges through recognized diagnostic continuations and neighboring context. Increasing a fixed overlap alone will not establish failure-record preservation. Deduplicate overlapping text when rendering.

**Test:** Parameterize the failure header across every position in a chunk and vary diagnostic length instead of testing a single boundary example.

### 5. P2 — Exact repository results can return a stale match location

Locations: [search.ts:185](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:185), [search.ts:203](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:203).

Ripgrep produces a line number from its own read. The code subsequently reads the file again and applies that old line number to the new snapshot without checking that the expression still matches. Hashing and excerpting the same new buffer is an improvement, but does not verify that the result is still a search hit. A concurrent edit can shift or remove the match and produce an unrelated excerpt labeled `ripgrep exact match`.

**Evidence:** Source-level read ordering; unlike findings 1, 3 and 4, this race was not forced in a filesystem probe during this review.

**Fix:** Validate the match against the snapshot used for the excerpt, or detect changed files and rerun/drop the result with a clear retry condition. Keep regex behavior consistent with the search engine.

**Test:** A controlled file edit between search output and candidate reading, including insertion before the hit and removal of the matching text.

### 6. P2 — Budget calculation introduces quadratic synchronous work

Locations: [deterministic.ts:106](/Users/libinjoseph/Projects/AlphaOptimizer/src/selection/deterministic.ts:106), [deterministic.ts:153](/Users/libinjoseph/Projects/AlphaOptimizer/src/selection/deterministic.ts:153).

For each optional candidate, the selector rebuilds and sorts the selected collection, scans the entire original chunk array, and renders the selection to estimate its size. With many positively scored candidates, this repeatedly scans all chunks even after few additional candidates can fit. This executes synchronously on the MCP event loop.

**Measured local synthetic probe:** 1,000 candidates took approximately 32 ms; 4,000 took approximately 279 ms at the same 1,500-token budget. These are illustrative single-run timings, not production benchmarks. The source establishes the repeated whole-array traversal; short-line logs can generate far more chunks within the allowed byte limit.

**Fix:** Precompute rendered block costs, maintain incremental totals and reason-code overhead, and perform an exact final budget check once. Bound chunk count and avoid sorting/re-rendering the full selected set for every rejected candidate. Preserve explicit mandatory overflow behavior.

**Test:** Scaling across increasing candidate counts, timer responsiveness during selection, and exact final response budgeting.

## Fixes verified and status changes

- Public MCP session spoofing now fails: the server uses its configured session rather than caller-supplied IDs. Verified with two compiled MCP clients sharing a store.
- A public `handle_hook` call marked `secret` now returns no artifact. Shared schema wiring fixes the earlier dropped-field defect.
- All 28 existing tests pass, including ignored-file fallback, UTF-8 progress, cancellation, quota rollback/concurrency, and provider fallback cases.
- Repository operations now use asynchronous subprocesses and file reads with deadlines and scan limits.
- Expiry cleanup and aggregate quota enforcement are implemented, including transactional recovery. Active-request protection remains finding 1.
- The invalid default hook file has been removed from the package; the adapter always passes through. Transparent host replacement remains unsupported rather than falsely enabled.
- Jev is now integrated behind explicit sharing/terms flags, privacy classification, request/response limits, timeout, and deterministic fallback. This review made no live provider request and does not establish its actual API behavior, billing, ranking quality, or latency.
- Clean builds, test type-checking, and a prepack build step now exist.

## Checks run

| Check | Result |
|---|---|
| `npm test` | 28 passed in 6 files |
| `npm run typecheck` | Passed |
| `npm run typecheck:tests` | Passed |
| `npm run build` | Passed |
| Compiled MCP SDK calls | Startup, capture, rejected forged-session read, and secret-hook rejection verified |
| `npm audit --json` | Zero known dependency vulnerabilities reported |
| New synthetic probes | Active-request eviction, missing search hit/completion metadata, diagnostic omission, selector scaling |

## Remaining engineering and release work

- Resolved after review: the project now includes an MIT `LICENSE`, and `package.json` declares `MIT`.
- Formatting is improved, but there is still no formatter/linter check or CI configuration in the reviewed tree.
- Database row decoding still uses `any`. The store combines quota policy, migrations, file recovery, artifact retrieval, FTS, and criteria. Extract narrow components around those responsibilities while preserving the transaction boundary; avoid splitting one atomic operation across independent stores.
- Public routes still access the concrete store directly. Put authorization and retrieval contracts behind application services so the same rules apply to every tool.
- The provider's deadline is bounded, but caller cancellation is not passed through `select_evidence` to the provider. A cancelled request can still finish its provider work. Thread an AbortSignal through the engine and combine it with the timeout.
- Criteria still cannot acquire verified evidence through the public API. Keep describing this feature as registration/reporting rather than completion verification.
- Some older tests still leave temporary directories behind. Standardize teardown hooks and close stores even after failed assertions.
- The stored CLI hook-probe report is useful evidence supplied by the implementation. It was not rerun in this review and does not establish desktop compatibility.

**Recommended order:** fix active-request eviction and portable packaging first, then retrieval correctness and semantic diagnostic grouping, then selector scaling and the release checks. Do not close the remaining items solely because the existing suite is green; add the reproductions above as regression tests.
