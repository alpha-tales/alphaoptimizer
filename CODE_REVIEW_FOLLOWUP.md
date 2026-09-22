# AlphaOptimizer follow-up review

Date: 21 September 2026. This report supersedes the first review's current-status conclusions, but preserves its historical findings.

**Verdict: improved, but still request changes before a supported plugin release.** Eight tests now pass, and several original defects are corrected. The remaining findings below are based on the current implementation, including new executable probes. No application source was edited. The build regenerated `dist`.

## Validation

- `npm test`: 8 tests passed in 3 files.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Compiled server: connected through the MCP SDK and listed all 6 tools.
- `npm audit --json`: zero known dependency vulnerabilities at review time.
- `npm pack --dry-run`: 34 files, includes `dist/src/server.js`, excludes compiled tests.
- Disposable probes: ignored-file disclosure, forged session reads, dropped hook privacy metadata, UTF-8 non-progress, omitted assertion details, response-budget overflow, oversized artifact-search results, and startup from a different working directory.
- No actual Codex hook replacement or Jev API execution was validated. The directory still has no Git metadata, so this remains a source-tree review rather than a commit diff.

## Current findings

### R01 — P1: Git-ignored files still become searchable through fallback

Location: [search.ts:149](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:149).

When `rg --files` finds no eligible files, it exits with status 1. `candidateFiles` treats that as a reason to run `fast-glob`, which does not apply Git ignore rules. Thus an intentionally empty candidate set becomes an unrestricted-by-Git-ignore scan. Listing failures take the same fallback.

**Reproduced:** A repository with `.gitignore` containing `*` and a synthetic `private.txt` returned that file for `pear absent`. The search used the configured allowed root; this is an ignore-policy bypass within that root, not the previously demonstrated external-symlink escape.

**Fix:** Treat a successful empty enumeration as empty. Require ripgrep or use an alternative with equivalent ignore semantics. Never silently broaden the candidate set on an error. Centralize all exclusions across both execution paths.

**Test:** Root and nested ignores with zero eligible files, ignored sensitive files with ordinary filenames, and enumeration errors.

### R02 — P1: The public hook tool drops an explicit secret classification

Location: [server.ts:178](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:178).

`HookEventSchema` now accepts `privacyClass` and `captureCompleteness`, but the MCP registration schema does not. These properties are removed during input validation, so the adapter receives its defaults instead. The engine's new secret-capture rejection is therefore bypassed through the public hook tool.

**Reproduced through MCP:** Sending `privacyClass: "secret"` and `captureCompleteness: "truncated"` with synthetic output produced a stored artifact and no fallback reason.

**Fix:** Derive the MCP input schema from the adapter contract instead of manually copying fields. Ensure privacy and capture metadata survive every boundary. Add a full MCP call test; a direct engine test cannot detect this defect.

### R03 — P2: Session IDs remain caller claims, not enforced isolation

Locations: [server.ts:82](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:82), [workspace.ts:31](/Users/libinjoseph/Projects/AlphaOptimizer/src/util/workspace.ts:31).

Workspace allowlisting now works at the public boundary, and mismatched labels are checked in SQL. However, the caller still chooses the session ID. Another client allowed to use the same workspace can supply the original session ID and access its artifacts or criteria.

**Reproduced:** Two independent MCP clients sharing a store and allowed workspace; client B retrieved client A's artifact by submitting `session-A` and its artifact ID.

**Fix:** If session isolation is promised, bind the permitted session to trusted server/connection configuration and reject caller overrides. Alternatively, explicitly define all sessions in an allowed workspace as shared trusted data and remove session isolation as a security claim. Requiring an extra caller-supplied field alone does not create an authorization boundary.

This does not establish access by a remote unauthenticated client or a different OS account. It is a mismatch with the documented local session-scoping guarantee.

### R04 — P2: UTF-8 pagination can stop making progress

Locations: [evidenceStore.ts:290](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:290), [evidenceStore.ts:421](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:421).

The decoder shortens the page until it is valid UTF-8. If the first character is longer than the requested page size, it returns an empty page with the same cursor. A start offset inside a character has the same outcome. Repeated paging can loop forever.

**Reproduced:** Reading `😀X` with `startByte=0, maxBytes=2` returned empty text and `nextCursor=0`. Starting at byte 1 returned empty text and cursor 1.

**Fix:** Guarantee forward progress or return a specific invalid-range/page-size error. Use the extra bytes already read to finish a character under a documented bound, or require and validate character-aligned offsets. Avoid a potentially large decrement-and-decode loop.

**Test:** Page sizes 1–4, leading multibyte characters, arbitrary mid-character offsets, and repeated pagination until completion.

### R05 — P2: Failure details are still lost at fixed chunk boundaries

Locations: [text.ts:18](/Users/libinjoseph/Projects/AlphaOptimizer/src/parsers/text.ts:18), [deterministic.ts:68](/Users/libinjoseph/Projects/AlphaOptimizer/src/selection/deterministic.ts:68).

All pinned chunks are now retained, which fixes the original multiple-error defect. However, pinning is still limited to fixed 40-line blocks. A failure header at line 40 does not retain assertion values on lines 41–42. Those lines can have no scoring keywords and are discarded even with ample budget.

**Reproduced:** `FAIL payment calculation` remained, while adjacent `Expected: 100` and `Received: 0` disappeared with a 1,500-token budget.

**Fix:** Parse complete failure records or conservatively retain adjacent diagnostic context. Preserve expected/actual values and stack continuations together with the failure header.

### R06 — P2: Hook integration remains an invalid packaged placeholder

Locations: [hooks.json:2](/Users/libinjoseph/Projects/AlphaOptimizer/hooks/hooks.json:2), [adapter.ts:44](/Users/libinjoseph/Projects/AlphaOptimizer/src/hooks/adapter.ts:44).

The configuration still lacks the documented top-level `hooks` container, uses an object matcher, and supplies only `event` while the tool requires `workspace`. The adapter still emits its internal `action`/`replacementText` response rather than the host response contract. README now correctly labels transparent replacement unsupported, but a placeholder file is still included in the plugin's default hook location.

**Fix:** Remove inactive hook configuration from the shipped plugin until supported, or complete both input mapping and output translation and validate them on the target host. A warning field in JSON is not an enable/disable mechanism. Preserve untrusted tool text as data, not trusted hook instructions.

Reference contract: [OpenAI hooks documentation](https://learn.chatgpt.com/docs/hooks). The exact host behavior was not exercised during this follow-up; required-input mismatch is also directly visible in the local schemas.

### R07 — P2: MCP startup still depends on the working directory

Location: [.mcp.json:5](/Users/libinjoseph/Projects/AlphaOptimizer/.mcp.json:5).

The emitted filename has been fixed. The plugin configuration still passes a relative path to Node, which resolves against the launch working directory.

**Reproduced:** Launching the configured command from a separate temporary project failed with `MODULE_NOT_FOUND`; launching the compiled absolute path worked.

**Fix:** Resolve the entry point against the installed plugin root using the host's supported mechanism. Test the actual packaged integration from an unrelated project directory. This probe establishes the command's cwd dependency, not a claim about an unobserved host's chosen cwd.

### R08 — P2: Artifact search bypasses the advertised response-size limit

Locations: [server.ts:86](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:86), [evidenceStore.ts:302](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:302).

When `query` is supplied, `read_artifact` ignores `maxBytes` and returns up to ten whole chunks. A chunk is bounded by line count, not bytes; one long log line can be megabytes. This defeats bounded retrieval and can flood the model context.

**Reproduced:** A single matching line returned 150,007 bytes through artifact text search. The same public branch ignores a caller's smaller `maxBytes` value.

**Fix:** Apply a shared byte/token budget to query and range results, return bounded match windows with cursors, and disclose omissions. Test huge single-line JSON/log records, not only short multiline logs.

### R09 — P2: Final selection still exceeds its budget without an overflow reason

Location: [deterministic.ts:103](/Users/libinjoseph/Projects/AlphaOptimizer/src/selection/deterministic.ts:103).

Chunk headers are now counted, but the footer and remaining response framing are not. `estimatedTokens` understates what is returned, and non-mandatory output can exceed the configured budget.

**Reproduced:** With a budget of 20, the selector reported 17 estimated tokens while the rendered response used 45 under the same estimator.

**Fix:** Budget the final rendered response, reserve fixed overhead before selecting chunks, and report unavoidable overhead/mandatory overflow explicitly. Assert the budget against the final text in tests.

### R10 — P2: Repository requests still block the server event loop

Locations: [search.ts:40](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:40), [search.ts:75](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:75), [search.ts:133](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:133).

Two-second timeouts improve the old unlimited child-process calls. Both remain synchronous, as do the potentially large file-reading loops. A slow request delays unrelated requests and cancellation. `excerptFor` also rereads a file for its hash, adding I/O and permitting hash/content disagreement if the file changes between reads.

**Fix:** Use asynchronous subprocesses with cancellation, bounded file concurrency and scan limits. Derive excerpts and hashes from one read. Add an event-loop/concurrent-request test rather than considering the `async` signature sufficient.

### R11 — P2: Expiry blocks reads but does not reclaim sensitive data or storage

Location: [evidenceStore.ts:224](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:224).

Expired artifacts now throw on lookup, which fixes the old accessible-after-expiry behavior. There is still no cleanup of raw files, metadata, chunk text, or FTS entries, and no aggregate quota. Repeated individually valid captures grow the store indefinitely. Expiry is access denial, not implemented deletion.

**Fix:** Implement coordinated retention cleanup and total quotas with an explicit policy for active evidence. Document deletion semantics honestly, including SQLite/WAL considerations; do not imply forensic erasure. Test storage reclaimed across all representations.

## Status of the first review

| Original finding | Current status |
|---|---|
| F01 external symlink / ignored files | Canonical containment and no-follow added; ignored-file fallback remains R01 |
| F02 artifact/criterion scope | Workspace allowlisting and scoped queries added; caller-chosen session limitation remains R03 |
| F03 later pinned failure dropped | Fixed for the reproduced multi-failure case; diagnostic-boundary gap R05 |
| F04 missing build entry point | Fixed; working-directory dependency remains R07 |
| F05 hooks | Still incomplete; R06 |
| F06 off/privacy | Off and direct secret observations short-circuit capture; public hook strips metadata, R02 |
| F07 size/retention | Per-artifact size and expiry reads enforced; cleanup/total quota absent, R11 |
| F08 budget | Optional selection no longer all mandatory; footer still omitted, R09 |
| F09 synchronous work | Still present despite timeouts; R10 |
| F10 exact ranges | CRLF byte accounting and raw-file hashing corrected in source; UTF-8 has R04 |
| F11 tuple ID collisions | Length-framed versioned ID implementation fixes the original ambiguity |
| F12 conflicting replay | Sequential conflicting-content replay now rejected; concurrency/migration not established |
| F13 storage fallback | Capture/index exceptions now produce original-content fallback; constructor failure still aborts startup |
| F14 booleans/provider | Boolean parsing corrected; Jev remains intentionally unconnected |
| F15 hook metadata | Adapter improved, but public boundary drops new fields, R02; host integration unproven |
| F16 criteria | Re-registration preserves state and empty checklist is unknown; evidence update/verification still absent |
| F17 private directory | Permissive data directories now rejected; cross-platform ownership/ACL behavior untested |
| F18 query behavior | Option separation, JSON output, and FTS quoting improved; invalid-regex exit status can still silently select lexical fallback |

## Maintainability and release follow-ups

- Derive schemas once: the new privacy bug is direct evidence that duplicated boundary schemas are already drifting.
- Database decoding still uses `any`; repeated chunk mapping remains. Narrow store interfaces and application services would make policy enforcement harder to bypass.
- Tests still omit static type-checking: `tsconfig.json` excludes `tests`, and the original selection test dereferences nullable `result.artifact` without narrowing. Add a test-specific type-check configuration.
- Most tests still leave temporary directories behind, with database closure after assertions rather than guaranteed teardown.
- No formatting/lint scripts or CI configuration are present. Formatting is generally consistent, but enforcement and async/error-path tests are still needed.
- Package contents are cleaner and README, SECURITY, CONTRIBUTING, and LICENSE now exist. `package.json` declares `MIT`.
- A `prepack` build step now exists. Test publication from a clean checkout, not only from an already built directory.
- Validate empty/invalid workspace-list settings: a nonempty string containing only `:` parses to an empty list, which means unrestricted access even when the unrestricted toggle is false.
- Sensitive filename globs such as `*token*` also exclude ordinary source like token parsers. Make the policy configurable and disclose exclusions rather than presenting missing results as complete search coverage.
- Jev, patch verification, evidence-based completion updates, and meaningful benchmark evaluation remain incomplete. The updated README is more candid; keep that distinction in release claims.

## Next correction order

1. Fix R01 and R02 with real public-tool regression tests.
2. Resolve the session-sharing contract, guarantee UTF-8 progress, and preserve whole failure diagnostics.
3. Bound all retrieval responses and remove or complete the packaged hook placeholder.
4. Validate installed-plugin startup from another project, add retention/quota management, and make search cancellation responsive.
5. Add clean-package CI, test type-checking, formatter/linter checks, and an explicit license before publication.

No source fixes were applied during this review. Passing tests and the dependency audit remain useful checks, but do not cover the reproduced defects above.
