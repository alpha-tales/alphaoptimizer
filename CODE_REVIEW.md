# AlphaOptimizer code review

Reviewed: 21 September 2026

## Verdict

**Request changes before presenting this as a ready-to-use open-source plugin.** The modules are small and reasonably separated, but important security boundaries, evidence-preservation behavior, integration contracts, and release checks are incomplete. This is a prototype rather than the completed implementation described in the plan.

The review covered every source module, the two tests, evaluation and compatibility scripts, package configuration, plugin configuration, and operational documentation. No Git repository was present, so this is a whole-directory review, not a commit or PR diff review. Application source was not changed. The build regenerated compiled output; this report is the only authored review artifact.

Severity: **P1** = release blocker; **P2** = significant correction before a supported release; **P3** = maintainability or release hygiene. Findings distinguish executable reproductions from source inspection. Security findings concern the local MCP server's authority and data isolation; no public network service or remote exploit was established.

## Verification performed

| Check | Result |
|---|---|
| Existing tests | 2 tests passed in 2 files |
| TypeScript type-check | Passed |
| TypeScript build | Passed |
| Configured startup: `node dist/server.js` | Failed with `MODULE_NOT_FOUND` |
| MCP source startup through `tsx` | Connected and listed 6 tools |
| Dependency audit | `npm audit --json` reported zero known vulnerabilities at review time |
| Package dry run | Includes source, scripts, internal plan, and stale compiled tests; missing configured server entry point |
| Synthetic security and correctness probes | Confirmed findings below using disposable directories and synthetic data |
| Actual Codex hook replacement | Not established; configuration and adapter already disagree with documented contracts |
| Jev API or cost effectiveness | Not tested; provider is not called by the engine |

The dependency audit does not validate application security. Passing two happy-path tests does not establish production quality.

## Findings

### F01 — P1: Repository fallback escapes the workspace and exposes excluded files

Locations: [search.ts:101](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:101), [search.ts:53](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:53).

The ripgrep branch checks canonical containment, but the fallback glob follows symlinks and reads candidates without that check. Root workspace allowlisting therefore does not constrain the files actually read. The fallback also enables hidden files and applies only the top-level `.gitignore`; it does not preserve nested ignore behavior or an explicit sensitive-file policy.

**Reproduced:** An allowlisted temporary repository contained a symlink to a synthetic secret outside it. A multiword query that missed ripgrep's full expression returned the external text. Other queries returned `nested/private.txt` despite its nested `.gitignore`, and a hidden `.env` file. No real secrets were accessed.

**Fix:** Use one candidate policy for both search paths. Disable symlink traversal, canonicalize and verify every candidate before reading, honor nested ignore rules, and explicitly exclude sensitive paths by default. Handle files that disappear or change during traversal. For a hostile writable tree, also account for check/open races instead of treating one realpath check as complete protection.

**Regression tests:** Symlinked files and directories outside the root, nested ignore files, hidden secret files, unreadable files, and deletion during scanning.

### F02 — P1: Artifact and criterion APIs bypass workspace/session isolation

Locations: [server.ts:69](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:69), [server.ts:127](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:127), [evidenceStore.ts:213](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:213).

`read_artifact` authorizes by artifact ID alone. All clients use a shared data directory by default. `select_evidence`, `record_criterion`, and `check_completion` accept caller-supplied scope without checking the configured workspace allowlist. An artifact handle is effectively a cross-workspace bearer credential, even when the second server is explicitly restricted to a different workspace.

**Reproduced through two real MCP clients:** Client A captured synthetic private data. Client B, allowlisted only for workspace B, read A's artifact using its handle, read A's criteria, and captured data labeled as A.

**Fix:** Bind trusted workspace/session context at the connection or server boundary. Apply canonical scope checks consistently to capture, retrieval, search, and criteria operations. Scope SQL queries to that context and reject mismatched handles. Merely asking the caller to supply a session ID is not authentication. Default to a configured root or an explicit allowlist; make unrestricted developer mode opt-in.

**Regression tests:** Separate clients sharing one store, reused handles across workspaces, forged scope fields, and canonical path aliases.

### F03 — P1: Selection drops later critical failures

Location: [deterministic.ts:50](/Users/libinjoseph/Projects/AlphaOptimizer/src/selection/deterministic.ts:50).

The selector stops as soon as the budget is exhausted and any pinned chunk has been selected. Later pinned chunks are never considered. This contradicts the core goal of preserving all distinct failure evidence.

**Reproduced:** A 120-line log with two separate pinned error blocks and a small budget returned only one of the two pinned blocks.

**Fix:** Collect mandatory evidence before optional ranking. If mandatory evidence exceeds the budget, explicitly expand the budget or return the original output with an overflow reason. Retain adjacent assertion/stack context across chunk boundaries.

**Regression tests:** Several failures in different blocks, oversized first failure, assertions spanning lines 40/41, and a summary after several error blocks.

### F04 — P1: Published entry points do not exist after building

Locations: [package.json:5](/Users/libinjoseph/Projects/AlphaOptimizer/package.json:5), [.mcp.json:5](/Users/libinjoseph/Projects/AlphaOptimizer/.mcp.json:5), [tsconfig.json:12](/Users/libinjoseph/Projects/AlphaOptimizer/tsconfig.json:12).

`main`, `bin`, and MCP configuration reference `dist/server.js`. With `rootDir: "."`, TypeScript generates `dist/src/server.js`.

**Reproduced:** Build passed; running the configured command immediately failed with `MODULE_NOT_FOUND`. Source startup works, which is why a development-only check misses the packaging defect.

**Fix:** Align build layout and package/plugin paths. Resolve the MCP entry point against the installed plugin root, not an incidental working directory. Declare a supported Node range and test the packaged executable from outside the checkout.

**Regression test:** Pack, install into a temporary directory, start through the published command, perform MCP initialize/list/call, and shut down cleanly.

### F05 — P1: Hook configuration and responses are not valid host integration

Locations: [hooks.json:2](/Users/libinjoseph/Projects/AlphaOptimizer/hooks/hooks.json:2), [adapter.ts:6](/Users/libinjoseph/Projects/AlphaOptimizer/src/hooks/adapter.ts:6), [adapter.ts:39](/Users/libinjoseph/Projects/AlphaOptimizer/src/hooks/adapter.ts:39).

The configuration uses an array of `{ event, mode, mcpTool }` entries. The adapter expects custom camel-case fields and returns `{ action, replacementText }`, with no translation into the host output schema. These are internal placeholder contracts, not a working Codex hook implementation.

Official documentation specifies event-keyed hook groups, `mcp_tool` handlers with server/tool/input mapping, and event-specific responses. The current files do not implement that shape. [OpenAI hooks documentation](https://learn.chatgpt.com/docs/hooks)

**Fix:** Implement a versioned host adapter and validated configuration using recorded host fixtures. Preserve the original response when unsupported. Keep filtering unavailable until a supported host trace demonstrates replacement and original-output recovery. Do not promote arbitrary tool-output instructions into trusted hook guidance.

**Validation:** Real disposable-workspace tests for success, failure, mixed responses, truncation, streaming, unavailable server, and multiple hook integrations. Parsing JSON alone is insufficient.

### F06 — P2: `off` mode still persists raw output, and privacy labels are not enforced

Locations: [optimizer.ts:17](/Users/libinjoseph/Projects/AlphaOptimizer/src/optimizer.ts:17), [server.ts:53](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:53), [adapter.ts:35](/Users/libinjoseph/Projects/AlphaOptimizer/src/hooks/adapter.ts:35).

Mode is checked only after capture, chunking, and indexing. The engine also persists observations marked `secret`; public adapters hard-code `normal`. The operations guide currently describes `off` as disabling selection only, so it should not be mistaken for a functioning kill switch for recording.

**Reproduced:** An engine in `off` mode persisted and indexed an observation labeled `secret`.

**Fix:** Define separate capture and filtering policies, or make `off` short-circuit all optimizer work. Apply tool/workspace privacy rules before storage and before any future provider call. Expose the effective recording policy clearly. Avoid promising that a simple regex can perfectly redact arbitrary secrets.

### F07 — P2: Artifact-size and retention controls are declared but unused

Locations: [config.ts:9](/Users/libinjoseph/Projects/AlphaOptimizer/src/config.ts:9), [optimizer.ts:16](/Users/libinjoseph/Projects/AlphaOptimizer/src/optimizer.ts:16), [evidenceStore.ts:250](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:250).

`maxArtifactBytes` is never enforced. `expiresAt` is written but neither checked on retrieval nor used for cleanup. Raw content is additionally copied into chunks and the FTS index. Unlimited input can consume memory and disk, and supposedly expired data remains accessible.

**Reproduced:** A configured 16-byte maximum accepted 1,000 bytes. An artifact with an expiry in the year 2000 remained readable.

**Fix:** Enforce byte limits before copying/writing; add cumulative quotas, an explicit oversized-input policy, and active-reference retention rules. Cleanup must remove artifacts, metadata, chunks, and FTS rows consistently. Return an explicit expiry result rather than silently claiming no evidence exists.

### F08 — P2: Selection budget can be exceeded by ordinary output

Location: [deterministic.ts:52](/Users/libinjoseph/Projects/AlphaOptimizer/src/selection/deterministic.ts:52).

Every candidate scoring at least 20 is mandatory. Ordinary test-summary, diff, or search-hit chunks meet that threshold. If none are pinned failures, the budget-exhausted break never runs. Rendering also adds headers and a footer that are absent from `estimatedTokens`.

**Reproduced:** A 10-token budget selected all five ordinary test-output chunks, estimated at 773 tokens before rendering and approximately 877 afterward.

**Fix:** Separate mandatory evidence from relevance scores. Budget optional chunks against the final response estimate, including labels and retrieval guidance. Report mandatory overflow explicitly. Keep token estimates labeled as estimates.

### F09 — P2: Async signatures hide blocking work and unbounded scans

Locations: [search.ts:36](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:36), [search.ts:53](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:53), [evidenceStore.ts:253](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:253).

`searchRepository` uses `spawnSync` without a timeout, then synchronous stat/read loops. The result limit does not limit the number of files scanned. The ripgrep path gathers up to 4 MB before slicing; repeated matches reread and hash the same file. A tiny artifact range reads the entire file. Capture is marked `async` but performs all storage and parsing synchronously.

This blocks other requests on the server event loop and prevents responsive cancellation. Declaring a function `async` does not move its work off-thread.

**Fix:** Use an asynchronous child process with a deadline, cancellation, and bounded output. Stop once sufficient validated candidates are collected. Use bounded asynchronous file reads, cache each file within a query, and seek directly for artifact ranges. Keep SQLite synchronous if measurements justify it; otherwise isolate the store/large parsing workload in a worker. Avoid replacing bounded loops with unbounded `Promise.all`.

**Validation:** Concurrent large search plus small retrieval, cancellation, broad-query output overflow, and p95 event-loop delay. No large-workload performance claims were established by this review.

### F10 — P2: Exact-evidence byte and character boundaries are incorrect

Locations: [text.ts:11](/Users/libinjoseph/Projects/AlphaOptimizer/src/parsers/text.ts:11), [evidenceStore.ts:257](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:257), [search.ts:90](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:90).

Chunking converts CRLF to LF, then calculates offsets over the converted text while the artifact stores original bytes. Pagination decodes arbitrary byte slices independently, splitting UTF-8 characters. Repository hashes also represent normalized line endings rather than original file bytes.

**Reproduced:** A later CRLF chunk did not match its original byte range. Two pages split through an emoji could not be concatenated back into the original string.

**Fix:** Calculate offsets and hashes from the original bytes. Use a byte-preserving API or character-aligned text pagination with cursors reflecting actual consumed bytes. Specify newline normalization separately from source identity.

### F11 — P2: Concatenated identity fields collide across scopes

Location: [hash.ts:7](/Users/libinjoseph/Projects/AlphaOptimizer/src/util/hash.ts:7).

`shortId` hashes adjacent inputs without length framing. Different tuples can have identical preimages; this does not require breaking SHA-256.

**Reproduced:** Session/tool pairs `("ab", "c")` and `("a", "bc")` in the same workspace produced the same artifact ID for the same content. The second returned object claimed session `a`, but persisted metadata belonged to `ab`.

**Fix:** Hash a versioned, unambiguous tuple encoding, such as canonical JSON with type tags or length-prefixed buffers. Handle migration explicitly rather than silently changing existing IDs.

### F12 — P2: Event replay can return evidence inconsistent with persisted state

Locations: [evidenceStore.ts:111](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:111), [evidenceStore.ts:159](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:159), [evidenceStore.ts:179](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:179).

Artifact identity includes content but event identity does not. Reusing a tool-call ID with changed content inserts a new artifact while `insert or ignore` leaves the event referencing the previous artifact. Even a same-content replay returns newly constructed timestamps rather than the stored record.

**Reproduced:** Two captures of one event with different content produced two artifacts and one event. This matters for retries and partial-to-final streamed observations.

**Fix:** Define replay semantics. Reject conflicting payloads or represent explicit observation revisions, with a transaction that keeps the event/artifact relationship consistent. Return persisted metadata. Separate artifact publication from indexing readiness and recover orphan files after failed transactions.

### F13 — P2: Storage failures do not return a usable fallback

Locations: [optimizer.ts:17](/Users/libinjoseph/Projects/AlphaOptimizer/src/optimizer.ts:17), [server.ts:43](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:43).

Capture and indexing exceptions escape the engine. The MCP operation returns an error rather than the original evidence. No explicit engine result communicates a fallback or partial storage failure.

**Reproduced:** A store failure caused `captureAndSelect` to throw. Actual host behavior after a hook failure remains untested; it must not be assumed to suppress the original tool result.

**Fix:** Return a typed pass-through outcome for optimization failures, preserve the input evidence where appropriate, and log bounded diagnostics to stderr. Distinguish invalid/unauthorized input from internal optimizer failure; authorization failures must remain denied. Do not report successful storage before its prerequisites succeed.

### F14 — P2: Jev configuration has an inverted boolean and no runtime integration

Locations: [config.ts:15](/Users/libinjoseph/Projects/AlphaOptimizer/src/config.ts:15), [jev.ts:17](/Users/libinjoseph/Projects/AlphaOptimizer/src/providers/jev.ts:17), [optimizer.ts:38](/Users/libinjoseph/Projects/AlphaOptimizer/src/optimizer.ts:38).

`z.coerce.boolean()` treats the string `"false"` as truthy. The documented setting therefore parses as enabled. Separately, `JevProvider` is never instantiated or called by the server/engine, so enabling the flag currently has no effect on selection. This is not evidence of current outbound data leakage; the provider is unreachable through the reviewed runtime.

**Reproduced:** `ALPHAOPTIMIZER_JEV_ENABLED=false` parsed to `true`.

**Fix:** Parse a strict boolean vocabulary and reject invalid values. Either explicitly reject unsupported enablement, or wire a tested provider interface with privacy policy, bounded text sizes, duplicate/missing-ID handling, a verified API contract, and deterministic fallback. Require HTTPS for credentials outside an explicit local-test mode. Existing request timeout and unknown-ID validation are good starting points.

### F15 — P2: Hook metadata overstates capture quality

Locations: [adapter.ts:33](/Users/libinjoseph/Projects/AlphaOptimizer/src/hooks/adapter.ts:33), [adapter.ts:37](/Users/libinjoseph/Projects/AlphaOptimizer/src/hooks/adapter.ts:37), [optimizer.ts:18](/Users/libinjoseph/Projects/AlphaOptimizer/src/optimizer.ts:18).

Every hook result is marked complete, textual, and normal-privacy; the engine marks its source `mcp`. Missing event IDs share global default strings. An object input becomes `"[object Object]"` when used as the task goal. The rendered selection does not preserve tool status/exit code, even though they are stored in the events table.

**Reproduced:** A hook observation carrying a truncation indication was still recorded as complete, with capture source `mcp`. The adapter has no completeness field to carry an authoritative indication.

**Fix:** Normalize real typed host payloads, preserve status and capture uncertainty, use actual task context, and require stable event identity or generate an explicit synthetic identity. Unsupported/mixed output should pass through. Do not label unknown completeness as complete.

### F16 — P2: Completion tracking cannot progress through the public API

Locations: [server.ts:120](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:120), [server.ts:148](/Users/libinjoseph/Projects/AlphaOptimizer/src/server.ts:148), [evidenceStore.ts:303](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:303).

The public registration tool can only create `unknown` criteria. There is no tool or observer to attach validated evidence, revisions, or supported/failed states. Re-registering a criterion defaults status to unknown and evidence to an empty list, overwriting prior verification stored through the internal API. Empty criteria return empty gaps without an explicit “no criteria recorded” state.

**Reproduced:** Registering an already supported criterion again erased its evidence and reset it to unknown.

**Fix:** Separate criterion creation from evidence updates. Preserve state on idempotent registration; verify evidence ownership and existence, record the tested revision, and invalidate stale results after relevant edits. An empty checklist must remain explicitly unknown. Never equate a model-supplied status with verification.

### F17 — P2: SQLite copies can be readable outside the intended private directory

Location: [evidenceStore.ts:26](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:26).

Raw artifacts use restrictive permissions, but full chunks and criteria also live in SQLite. If a user configures an existing permissive data directory, creating the `artifacts` subdirectory with mode 0700 does not secure that parent. SQLite and WAL files use process-default permissions.

**Reproduced:** With a pre-existing 0755 data directory and the current umask, the database was created as 0644. The fresh default-directory path does not necessarily have this exposure; the finding is conditional on the configured directory.

**Fix:** Require or create a dedicated private data directory, validate its ownership/permissions, and protect database sidecars as well as artifact files. Avoid silently changing permissions on an unrelated shared directory. Document platform-specific behavior.

### F18 — P2: Search errors silently change query semantics

Locations: [search.ts:36](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:36), [search.ts:50](/Users/libinjoseph/Projects/AlphaOptimizer/src/repository/search.ts:50), [evidenceStore.ts:262](/Users/libinjoseph/Projects/AlphaOptimizer/src/store/evidenceStore.ts:262).

No matches, invalid regex, missing ripgrep, and output overflow all trigger the same lexical fallback. Regex queries become whitespace-separated substring queries without any notice. Leading-dash queries are parsed as ripgrep options because they are not protected by `-e`/`--`. Artifact search similarly exposes raw FTS query syntax without a declared query language or normalized errors.

**Fix:** Declare literal/regex/lexical search modes. Pass patterns as data, distinguish exit code 1 from actual errors, and report fallback/truncation metadata. Quote literal FTS terms or explicitly document and validate advanced syntax. Use structured ripgrep output to avoid ambiguity in filenames containing colons/newlines.

**Scope of evidence:** An argument-injection probe did not establish command execution. This review does not claim an RCE vulnerability.

## Maintainability, DRY, SOLID, and formatting

The current physical module split is a good starting point. The problem is incomplete boundaries, not a need for an elaborate abstraction framework.

| Area | Assessment | Recommended change |
|---|---|---|
| Single responsibility | `EvidenceStore` owns schema creation, files, events, chunks, search, and criteria | Extract small repositories and an artifact-file component when implementing lifecycle policies; keep transactions coordinated |
| Dependency inversion | Engine accepts a store but depends on the concrete SQLite class; routes access it directly | Introduce narrow store/provider/policy interfaces and route through application services that enforce scope |
| Open/closed principle | One parser and selector are hard-wired; Jev is disconnected | Use a small parser registry and provider strategy only where multiple implementations exist |
| Interface segregation | Consumers can access the entire public database and store | Expose the operations each service needs; keep DB implementation details private |
| Liskov substitution | No meaningful subtype hierarchy to assess | Do not claim compliance or add inheritance just to satisfy a checklist |
| DRY | Chunk row mapping repeats; hook schemas repeat; failure patterns overlap; versions and provenance enums repeat | Centralize row decoders, derive tool schemas from shared contracts, and separate deliberate different policies from accidental duplication |
| Type safety | `strict` enabled, but database results use `any` and exported schemas are often not applied | Decode unknown database rows with typed validators; validate public boundaries once; use type-only imports |
| Async design | Async function signatures wrap blocking work | Address F09; propagate cancellation; make ownership and shutdown explicit |
| Formatting | Generally consistent indentation; dense nested objects and long calls remain | Add a pinned formatter and CI check rather than relying on manual style |
| Linting | No lint script/configuration | Add TypeScript-aware rules for floating promises, unused imports, unsafe `any`, and consistent imports; tune rules to the codebase |
| Lifecycle | Server has no explicit teardown path for its database | Close transport/store on normal termination and test shutdown; avoid noisy stdout that would corrupt MCP |

Additional small corrections:

- `assertPathInsideWorkspace` rejects legitimate names starting with `..` such as `..notes`; check for the parent component specifically. Resolve relative targets against the workspace before checking existence.
- `getChunks` and criteria lookups lack indexes matching their scope/order filters. Add indexes based on measured plans as stored data grows; do not assume primary keys cover these access patterns.
- Prepared statements are recreated for repeated operations. Reuse hot statements after correctness and profiling justify it.
- Search slices matches before discarding oversized/invalid files, so it can return too few results even when valid matches follow. Filter first, then stop at the requested count; deduplicate overlapping excerpts.
- Artifact integrity hashes are stored but never checked on retrieval. Define corruption detection and explicit recovery behavior.
- Test temporary directories are not cleaned up, and a failed assertion can skip store closure. Use `try/finally` or test teardown hooks with `mkdtemp`.
- `commander` and direct `minimatch` imports are absent from the source. Remove unnecessary direct dependencies after confirming packaging needs.

## Open-source release readiness

**Resolved after review:** The project now includes an MIT `LICENSE`, and `package.json` declares `MIT`.

**P3 packaging/documentation work:**

- Add a README with accurate implemented capabilities, current limitations, prerequisites, installation, a working MCP configuration, examples, storage/privacy behavior, and uninstall instructions.
- Add SECURITY.md with a private reporting channel and threat model. Explain trusted local process scope, allowed workspaces, stored content, retention, and optional provider egress.
- Add CONTRIBUTING.md, supported Node/OS versions, repository/issue metadata, release notes, and CI for tests, type-check, formatting, and packaged startup.
- Add an explicit package `files` allowlist and a clean build/prepack step. The dry run currently includes stale compiled tests, evaluation scripts, and the internal plan. Review the plan for local machine paths and personal context before publication.
- Decide whether compiled output is tracked. Current `.gitignore` excludes neither `dist/` nor local credential files. Use a safe secret-file policy and inspect the publication contents; do not rely on ignore rules as a security scan.
- Replace placeholder author/developer metadata with the intended public identity.
- Make the compatibility report distinguish measured startup from build success. Its generator hard-codes “MCP stdio server starts: supported” despite not starting a server.
- Replace the one-fixture evaluation with labeled held-out tasks measuring retained evidence, final response size, recovery calls, latency, and task outcome. The existing script only prints selected/omitted counts.

## Implementation gaps versus the plan

| Capability | Reviewed implementation |
|---|---|
| Durable evidence capture | Basic SQLite/files implementation; lifecycle and integrity gaps above |
| Deterministic evidence selection | Fixed 40-line blocks; critical retention and budget bugs |
| Jev reranking | Unused provider scaffold; no verified integration |
| Repository evidence retrieval | Ripgrep plus full-scan substring fallback; no repository BM25 index or semantic ranking |
| Patch verifier | Not implemented |
| Completion verification | Criterion registration/listing only; no evidence validation or revision invalidation |
| Validated transparent hooks | Not implemented/proven |
| Failure and cost telemetry | No complete implementation |
| Benchmark and pilot gates | Not demonstrated |
| Compaction, browser, duplicate suppression, subagent optimization | Deferred/not implemented |

It is reasonable to publish a clearly labeled experimental prototype after fixing the security and startup defects. It would be inaccurate to present all planned capabilities as complete or to claim measured savings.

## Recommended correction order

1. Fix workspace containment and cross-session isolation (F01–F02); add adversarial MCP integration tests.
2. Fix critical evidence preservation (F03), budget handling (F08), and byte-exact retrieval (F10).
3. Repair packaged startup and host contracts (F04–F05), then prove them end to end.
4. Enforce privacy, disable behavior, quotas, retention, storage fallback, and private database permissions (F06–F07, F13, F17).
5. Correct identities, replay behavior, observation metadata, and criterion state transitions (F11–F12, F15–F16).
6. Bound asynchronous workloads and clarify query semantics (F09, F18).
7. Keep Jev explicitly unavailable until its flag, API, privacy, and fallback behavior are tested (F14).
8. Add release documentation, license, formatting/linting, clean packaging, and CI. Evaluate the corrected deterministic baseline before adding more features.

## Minimum regression suite before release

- Cross-workspace/session MCP reads and writes are rejected, including forged caller scope.
- External symlinks and excluded files never appear in either search path.
- Multiple distinct failures survive selection or trigger explicit pass-through.
- Budgets include response framing; noncritical candidates cannot bypass them.
- CRLF, Unicode, and pagination preserve exact source identity and retrieval.
- Duplicate/replayed events are deterministic and conflicting payloads are explicit.
- Off/privacy/size/quota/expiry policies are enforced before storage or egress.
- Disk errors, corrupt data, missing ripgrep, bad queries, and provider errors yield documented outcomes.
- Long searches can be cancelled while unrelated small requests remain responsive.
- Criteria retain evidence on re-registration and cannot claim support from stale/missing evidence.
- A packed installation starts, lists tools, completes a real call, and closes cleanly.
- Real supported-host hook tests prove what reaches the model before filter mode is enabled.

## What is already good

Parameterized SQL avoids direct SQL-string interpolation for caller values. Raw artifact files use restrictive creation permissions. Contract definitions and strict TypeScript provide a useful base. The provider has a timeout and rejects unknown candidate IDs. The skill correctly warns against permission approval and unsupported savings claims. These strengths are worth retaining while fixing the verified boundaries above.
