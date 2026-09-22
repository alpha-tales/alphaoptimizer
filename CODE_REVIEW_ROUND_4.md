# AlphaOptimizer — fourth code review

Reviewed: 21 September 2026. No application source fixes were applied; verification regenerated build output. This report updates the status from round three.

**Verdict:** The six previous findings are addressed by the current implementation and regression tests. No new P1 issue was identified in this pass. Three reproducible P2 correctness issues remain in artifact search. These are narrower than the earlier security, durability, and packaging defects; they should not be described as new security vulnerabilities.

## Findings

### 1. P2 — Literal search silently misses matches spanning chunks

Location: [evidenceStore.ts:648](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:648).

Search runs the literal expression independently against each stored chunk. Chunks are an internal storage boundary, but the public tool describes searching an artifact. A valid multiline literal present in the original artifact is missed when it crosses that boundary, and the response incorrectly appears complete.

**Reproduction:** Store 39 lines of noise followed by `HEADER\nDETAIL\n`. Search for the literal `HEADER\nDETAIL`. The original contains it, but the response has zero chunks and `hasMore: false` because the two lines fall in adjacent chunks.

**Fix:** Match against the original artifact with bounded streaming overlap, or carry enough text between neighboring chunks to cover the maximum accepted query. Return offsets in the original artifact and avoid duplicate hits. If multiline queries are intentionally unsupported, explicitly reject them and document that restriction instead of returning a false negative.

**Regression test:** Place a matching multiline literal at every chunk boundary, including CRLF and Unicode context, and compare results with searching the original string.

### 2. P2 — A hidden 1,024-byte window limit rejects otherwise valid queries

Location: [evidenceStore.ts:654](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:654).

The API accepts up to 1,000 JavaScript string units in a query and up to 100,000 response bytes, but each match window is capped at 1,024 bytes before checking the size of the hit. Accepted Unicode queries can exceed that byte count. Increasing the requested budget cannot make them work, and the error incorrectly blames the caller's budget.

**Reproduction:** A query of 300 emoji is 600 string units and 1,200 UTF-8 bytes. It is accepted by validation and exists verbatim in the artifact. Searching with `maxBytes: 5000` throws `Search byte budget is smaller than the matching text`.

**Fix:** Allow the complete hit whenever it fits the remaining caller budget; cap only additional context. Alternatively, validate and document a consistent UTF-8 query-size limit before searching. Keep the error tied to the actual exceeded constraint.

**Regression test:** ASCII, CJK, and emoji queries around 1,024 bytes with both sufficient and insufficient response budgets.

### 3. P2 — UTF-8 context decoding removes source characters and breaks offsets

Location: [evidenceStore.ts:854](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:854).

`boundedUtf8Prefix` returns `TextDecoder` output using default BOM handling. If the context begins with U+FEFF, decoding removes that character. This helper can decode an arbitrary substring of an artifact, so treating its first character as a removable file marker changes source evidence. Calculating `endByte` from the transformed text then produces a range that does not correspond to the returned excerpt.

**Reproduction:** Store `needle\uFEFFafter`, then search for `needle`. The returned text is `needleafter`, while slicing the original bytes using the reported offsets produces `needle\uFEFFaf`. The exact-evidence invariant fails.

**Fix:** Preserve BOM code points when decoding arbitrary source windows, for example with an explicitly configured decoder, or validate UTF-8 boundaries and return the original bytes without normalization. Derive offsets from consumed original bytes, not a transformed string.

**Regression test:** U+FEFF immediately after a match, at artifact start, and within concatenated log fragments. Assert that every returned text window equals its original byte slice.

## Previous findings: current status

| Round-three finding | Current implementation / validation |
|---|---|
| In-flight quota eviction | Durable leases cover capture and pending provider work, with a response retrieval grace period; tests exercise independent connections/processes and expiry |
| Machine-specific startup | Shipped config invokes the installed executable; package installation and startup from an unrelated directory passed in this review |
| Search truncates away the hit | Match-centered windows and accepted continuation cursors implemented; original long-line and multi-page regressions pass; edge cases above remain |
| Diagnostic details lost | Record-aware pinning replaces fixed overlap; parameterized boundary/diagnostic-length tests pass |
| Stale exact-search locations | Original ripgrep line is checked against the read snapshot; controlled insertion/removal tests pass |
| Quadratic selection | Incremental accounting and cooperative yields replace repeated whole-array rendering; scaling and exact-budget regression tests pass |

The earlier server-bound session and shared privacy-schema corrections remain present. This review does not reopen them without evidence of a regression.

## Checks run

- `npm test`: **37 tests passed in 7 files**.
- `npm run typecheck`: passed.
- `npm run typecheck:tests`: passed.
- `npm run build`: passed.
- `npm run test:package`: passed. The script packed the package, installed it into a separate temporary location, started its shipped MCP command from an unrelated project, and captured synthetic evidence.
- `npm audit --json`: zero known dependency vulnerabilities reported at review time.
- Additional disposable probes reproduced all three findings above using synthetic data. No real provider requests were made.

## Remaining release and maintenance work

- Resolved after review: the project now includes an MIT `LICENSE`, and `package.json` declares `MIT`.
- Formatting/lint enforcement and CI configuration remain absent from the reviewed tree. Add the checks already proven useful here, including installed-package startup, to CI.
- Continue reducing database `any` usage and duplicated row mapping. Preserve the coordinated transaction boundary while separating storage policy, file handling, and retrieval responsibilities.
- Some older tests still need guaranteed temporary-directory and store teardown.
- Transparent Codex hook replacement, live provider accuracy/latency/billing, and production savings remain unverified or explicitly unsupported. Passing this suite does not establish them.

This was a targeted whole-tree follow-up with emphasis on the recent fixes, not a formal security audit or proof that no other bugs exist. The source tree still has no Git metadata, so findings refer to the current files rather than a commit SHA.
