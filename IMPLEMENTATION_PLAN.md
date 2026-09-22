# AlphaOptimizer: review and implementation plan

Date: 21 September 2026  
Status: Planning only. No plugin, hooks, services, or application code implemented.

## 1. Recommendation

Proceed with a small, measurable prototype. The proposed split—deterministic processing first, Jev for narrow judgments, Codex for reasoning and generation—is a reasonable architecture. Its value must be demonstrated against a deterministic-only baseline.

The strongest initial opportunity is selecting evidence from large tool results and repository searches. Patch review and completion checking are useful supporting capabilities, but they should not initially control the session based on model scores.

Change the proposed order to: compatibility proof → measurement and storage → deterministic output selection → Jev reranking → repository retrieval → advisory patch and completion checks → controlled pilot. This isolates whether Jev adds value and avoids building ten features before proving the core premise.

## 2. Review of the supplied proposal

### Verified platform details

Official documentation describes `PreToolUse` argument rewriting and `PostToolUse` feedback replacing the original result. This is not a general output mutation API: `updatedMCPToolOutput` and `suppressOutput` remain unsupported. MCP hooks require an existing connection, run synchronously, and do not support `SessionEnd`. `SessionStart` can precede server readiness. Subagent-start context is additive; it does not establish removal of inherited context. Multiple matching hooks can run concurrently. Hook definitions require trust. These details require a compatibility test on each target client. [Official hooks documentation](https://learn.chatgpt.com/docs/hooks)

The installed CLI reports `codex-cli 0.149.0`. This identifies the local executable; it does not prove that the desktop app uses the same build or behavior. The AlphaOptimizer directory was empty before this document was created.

### Changes needed before implementation

| Proposal | Assessment | Implementation decision |
|---|---|---|
| Filter results after tools run | Strong hypothesis; depends on the exact result delivery path | Prove suppression of the original model-visible result before enabling filtering |
| Store complete raw output | Hooks may receive an already truncated representation | Record capture completeness; never describe partial data as full output |
| Ask 70 parallel relevance questions | May add latency, repeated input, rate limits, and cost | Shortlist first, batch where supported, cap concurrency and total candidates |
| Block redundant searches | Similar commands can observe changed state or intentionally verify findings | Begin with suggestions; later restrict suppression to proven, fresh, read-only duplicates |
| Select repository evidence | Strong, independently testable capability | Build exact excerpts, explicit omissions, and expandable retrieval |
| Classify tests as pre-existing or environmental | A classifier cannot establish causality | Treat these as hypotheses unless supported by comparison runs or direct evidence |
| Review every patch | Useful signal, potentially noisy and expensive | Inspect successful edits; debounce checks and deduplicate alerts |
| Prevent incomplete stopping | Useful only with explicit acceptance criteria | Use evidence states and bounded continuation; do not let Jev certify success |
| Preserve compaction memory | Useful later; overlaps existing local memory tooling | Maintain a task ledger and test coexistence before adding injection |
| Give subagents only selected context | Additive context does not prove reduced inherited context | Defer until actual inheritance controls and token savings are established |
| Optimize browser output | Each tool has different interaction and observation contracts | Separate later adapter; preserve actionable identifiers and original observations |
| Automatically derive workflows | Requires reliable traces and review | Suggest candidate workflows later; do not auto-install or auto-execute them |

The quoted Jev pricing, latency, API capabilities, confidence semantics, and competitor savings are unverified inputs from the supplied proposal. Do not use them in a business case or implementation contract until checked against the provider and measured locally. No external project is a dependency of this plan.

Earlier local notes mention Hindsight hooks. Their current configuration was not inspected. Before installation, inventory existing hooks and preserve them; treat the earlier notes as a possible integration dependency, not current-state proof.

## 3. Scope and success criteria

### MVP scope

- A local MCP server with a versioned hook adapter.
- Durable evidence storage and on-demand retrieval.
- Deterministic selection for supported textual search and test outputs.
- Optional Jev reranking behind an interchangeable provider interface.
- Repository search returning exact, source-linked excerpts.
- Advisory patch checks and evidence-based completion checks.
- An offline evaluation harness and a reversible, project-scoped pilot.

### Excluded from the MVP

Permission approval, shell-command generation, destructive-action decisions, broad command rewriting, automatic workflow publication, browser optimization, subagent context replacement, hosted tool interception, and a graphical dashboard. Compaction integration and duplicate-call suppression follow only after the core pilot passes.

### Proposed pilot gates

These are engineering targets to validate, not predicted outcomes:

| Measure | Initial gate |
|---|---|
| Relevant evidence retention | At least 95% of human-labeled relevant spans; every labeled critical failure retained or explicitly surfaced for expansion |
| Raw recovery | Every successfully stored artifact retrievable until its declared expiry |
| Task correctness | No observed regression on the paired evaluation suite; publish sample size and uncertainty |
| Context reduction | At least 25% median reduction for eligible large outputs, including retrieval and hook overhead |
| Overall efficiency | Positive measured net benefit on the pilot workload, not just shorter individual outputs |
| Added latency | Initial target: p95 below 1 second per eligible output; report cold starts separately |
| Failure behavior | Provider, store, parser, and hook failures preserve normal tool visibility |
| Authority | No permission changes, mutation suppression, or unrequested execution |
| Completion loop | At most one automatic continuation per turn; no repeated continuation without new evidence |

Small outputs and unsupported result types pass through. If Jev does not improve quality or efficiency over deterministic processing, keep that workload deterministic.

## 4. Architecture and proposed layout

Use TypeScript on a pinned Node.js LTS release, the MCP SDK, schema validation, SQLite with FTS5, and local artifact files. Confirm compatible versions during scaffolding. Keep tree-sitter optional until lexical retrieval has been evaluated.

```text
Codex tool result or explicit repository query
                  |
          Versioned input adapter
                  |
       Eligibility and privacy checks
                  |
       Durable artifact + metadata
                  |
    Deterministic parsing and selection
                  |
         Optional Jev reranking
                  |
     Exact excerpts + retrieval handles
                  |
      Codex reasons over the evidence
```

Hooks call the same engine exposed through MCP. Keep selection logic independent from host-specific hook JSON. Provide a small command entry point only for lifecycle events that need it; do not introduce a general shell-execution proxy.

Proposed files to create during implementation:

```text
.codex-plugin/plugin.json
.mcp.json
hooks/hooks.json
skills/alphaoptimizer/SKILL.md
src/server.ts
src/config.ts
src/contracts/
src/hooks/
src/store/
src/parsers/
src/selection/
src/providers/jev.ts
src/repository/
src/verification/
src/telemetry/
tests/fixtures/
tests/contracts/
tests/integration/
eval/tasks/
eval/labels/
eval/run.ts
docs/compatibility.md
docs/operations.md
```

Manifest and MCP filenames above are proposed packaging targets. Validate their exact schema against the supported client before generating them. Store runtime data in an OS user-data directory outside tracked source, partitioned by workspace and session.

### Engine contracts

| Contract | Required fields and behavior |
|---|---|
| Tool observation | Schema version, workspace/session/turn/agent IDs, tool-call ID, tool name, timestamps, status, exit code if present, input hash, response type, capture completeness |
| Artifact | Opaque ID, content hash, byte length, encoding, capture source, expiry, privacy class, truncation flag |
| Chunk | Artifact ID, stable chunk ID, exact byte/line ranges, parser kind, source file and hash when applicable, pinned-evidence flag |
| Decision | Model/provider version, prompt/schema version, candidate IDs, enum verdicts, optional provider scores, latency, metered usage, failure reason |
| Selection | Selected IDs, omitted counts, selection reason codes, token estimate, expansion cursor, fallback mode |
| Ledger item | Acceptance criterion, evidence references, observed revision, status, provenance, unresolved question |

Use enum decisions such as `relevant`, `irrelevant`, and `uncertain`. Treat numerical scores as uncalibrated unless provider documentation and local evaluation establish otherwise. Jev supplies classifications over known IDs; templates in code produce explanations. Reject unknown IDs and malformed responses.

### MCP tools

- `select_evidence`: select chunks from an already captured artifact under a budget.
- `search_repository`: retrieve and rerank excerpts within an allowed workspace.
- `read_artifact`: retrieve bounded original ranges or search stored text; return pagination and completeness metadata.
- `record_criterion`: record explicit task criteria and provenance without claiming they are verified.
- `check_completion`: return criterion states and evidence gaps.
- `handle_hook`: normalize supported hook events and return the tested host-specific response.

Separate internal hook access from model-facing tools where packaging permits. Every retrieval must enforce workspace/session boundaries, canonicalize paths, reject traversal and symlink escapes, and avoid exposing arbitrary filesystem reads.

## 5. Detailed implementation sequence

### Phase 0 — Prove host compatibility

Dependencies: none. This is the first future implementation task.

1. Record CLI and desktop versions, supported transports, configured hook sources, trust state, and existing plugins without changing them.
2. Create a tiny test MCP server and disposable workspace with uniquely marked tool outputs.
3. Exercise post-tool feedback replacement on a successful command, a failed command, an MCP result, a large result, and a streaming command followed by polling.
4. Inspect a supported trace or request-observation interface to determine exactly what reaches the model. If unavailable, document that limitation; an assistant's statement alone does not prove absence of the original output.
5. Test direct MCP hook invocation, server-not-ready behavior, malformed responses, timeout, concurrent hook composition, and stop continuation.
6. Determine whether capture precedes truncation and whether mixed text/image/resource outputs retain their semantics.
7. Record each capability as supported, unsupported, or unknown in `docs/compatibility.md`, with reproducible fixtures and client versions.

**Exit gate:** Replacement and recovery are demonstrated on an explicitly supported path. If transparent filtering cannot be proven, disable that feature and scope the prototype to explicit evidence tools; do not claim transparent context savings.

### Phase 1 — Scaffold contracts, configuration, and evaluation

Dependencies: Phase 0 findings.

1. Initialize the project with strict TypeScript, a lockfile, formatting, schema validation, and targeted tests.
2. Implement versioned event, artifact, selection, and provider contracts.
3. Define `off`, `observe`, and `filter` modes. Default new installations to `observe`.
4. Add feature flags, workspace allowlists, privacy settings, result-size thresholds, selection budgets, deadlines, retention, and a kill switch.
5. Assemble at least 20 fixture tasks spanning repository navigation, verbose tests, empty results, failed commands, large diffs, and changing worktrees.
6. Human-label relevant spans and critical evidence before tuning selectors. Reserve a held-out portion.
7. Add measurements for bytes, estimated tokens, host-reported usage where available, provider usage, retrievals, latency, and task outcomes.

**Deliverable:** A deterministic fixture runner and baseline report with no external-model dependency.

### Phase 2 — Build durable evidence storage

Dependencies: Phase 1.

1. Create SQLite migrations for sessions, events, artifacts, chunks, decisions, criteria, and measurements.
2. Write artifact content atomically; persist metadata only once storage succeeds. Make replayed events idempotent using scoped event IDs.
3. Use SQLite transactions and bounded lock handling for concurrent sessions. Test recovery after process interruption.
4. Track complete, truncated, streamed, and unavailable capture states explicitly. Never reconstruct missing output by rerunning a mutating tool.
5. Implement bounded retrieval, text search, pagination, retention, quota enforcement, and deletion.
6. Pin artifacts referenced by an active task. Expiry must be visible and must never masquerade as an empty result.
7. Redact secrets from telemetry and outbound provider payloads. Restrict local raw artifacts to the user; support disabling capture for sensitive tools.

**Exit gate:** Exact range retrieval survives restart, cross-workspace access is rejected, and storage failure leaves original tool output visible.

### Phase 3 — Implement deterministic output selection

Dependencies: Phases 0–2.

1. Add parsers for ripgrep output and common structured test reports before general free-text logs.
2. Preserve command status, total counts where reliable, every distinct failure signature, assertion differences, relevant stack frames, timeout and truncation notices.
3. Deduplicate repeated blocks while retaining occurrence counts and original offsets.
4. Split at semantic boundaries and retain adjacent context. Do not cut assertions or stack traces arbitrarily.
5. Apply selection only to eligible textual results above an initial configurable threshold, such as 4,000 estimated tokens.
6. Render exact excerpts with artifact handles, omission counts, selection mode, and expansion instructions. Labels come from code templates.
7. Initially cap selected output near 1,500 estimated tokens, subject to the compatibility findings. If mandatory evidence exceeds that cap, expand the budget or pass through; never silently discard it.
8. Run in observation mode first. Enable replacement only for tested tool/result combinations; preserve typed metadata and error status.

**Exit gate:** Held-out fixtures retain critical evidence and retrieval works end to end. Unknown parsers or result types pass through.

### Phase 4 — Add optional Jev judgments

Dependencies: Phase 3 baseline.

1. Verify provider endpoint, authentication, supported schemas, model identifiers, usage reporting, limits, retention policy, and current prices before coding the adapter.
2. Define a minimal classification request: task goal, explicit constraints, candidate IDs, and bounded candidate text.
3. Remove credentials and prohibited data before egress. Keep external classification disabled for workspaces without an explicit data-sharing configuration.
4. Shortlist candidates deterministically, initially at most 40. Start with concurrency four and a total selection deadline around one second; tune from measurements.
5. Cache by workspace, goal version, content hash, provider/model, and prompt/schema version. Do not reuse decisions after any relevant key changes.
6. Pin critical evidence outside the model ranking. Retain uncertain candidates when affordable; otherwise disclose omitted candidates and offer expansion.
7. On timeout, malformed response, unavailable provider, or budget exhaustion, return the deterministic selection. Avoid serial retries on the hook path.
8. Compare deterministic-only and deterministic-plus-Jev on the held-out corpus. Ship Jev only where it improves the quality/cost/latency tradeoff.

**Exit gate:** Measured incremental benefit with no critical-evidence regression. Provider scores never become permission decisions.

### Phase 5 — Add repository evidence retrieval

Dependencies: Phases 2–4; Jev remains optional.

1. Index allowed text files with Git-ignore handling, explicit exclusions, size limits, canonical paths, and content hashes.
2. Use ripgrep for exact terms and SQLite FTS5/BM25 for lexical candidates.
3. Return path, line range, content hash, exact excerpt, and why the deterministic pipeline selected it.
4. Rerank only the bounded shortlist when Jev is enabled. Add syntax-aware boundaries later if measured retrieval failures justify them.
5. Refresh changed and untracked files as configured. Validate hashes at retrieval time so citations cannot silently point to changed content.
6. Support wider retrieval when evidence is insufficient. Distinguish zero matches from index failure or excluded content.

**Exit gate:** The held-out tasks identify expected files and spans, including after edits, renames, deletions, and branch changes.

### Phase 6 — Add patch and completion checks

Dependencies: evidence storage, host compatibility, and task criteria.

1. Capture successful patch events and the actual resulting diff. Isolate the turn's changes from pre-existing dirty files.
2. Use deterministic changed-path and risk-category checks first. Send bounded diff context to Jev only for narrow advisory questions.
3. Debounce repeated edits and emit each actionable concern once per relevant revision.
4. Attach a cited diff range or evidence handle to every alert. Treat unsupported concerns as suggestions, not findings.
5. Record acceptance criteria from explicit user requirements, plus required verification from project instructions. Keep inferred criteria labeled as proposed.
6. Represent each criterion as `supported`, `failed`, `unknown`, or `not_applicable`; link supporting evidence to the revision it tested.
7. Invalidate test evidence when subsequent changes affect its scope. A passing old run is not proof for a new patch.
8. Start stop checks in advisory mode. Later allow one continuation only for a concrete, authorized, actionable gap with a proposed next step.
9. Respect interruption, missing authorization, unavailable dependencies, and plan-only tasks. Do not demand implementation tests for a documentation request.

**Exit gate:** Incomplete work is reported accurately; valid completion is not trapped in a retry loop. Jev cannot mark acceptance criteria as proven without supporting evidence.

### Phase 7 — Package and run a controlled pilot

Dependencies: successful earlier gates.

1. Package the server, skill, hook definitions, version constraints, and project-scoped example configuration.
2. Document installation, trust review, exclusions, external-data behavior, raw retrieval, storage cleanup, mode changes, and removal.
3. Test coexistence with current memory and other hook integrations. Avoid relying on hook execution order.
4. Pilot on a disposable repository, then one explicitly selected real workspace.
5. Compare baseline, deterministic selection, and Jev-assisted selection using equivalent starting states and task prompts.
6. Review missed evidence, retrieval churn, false alerts, task outcomes, latency, and total cost before expanding coverage.
7. Disable any failing feature independently; preserve readable artifacts and unchanged host permissions.

**Exit gate:** Publish a bounded evaluation report and an exact support matrix. Broader rollout requires the pilot gates in Section 3.

## 6. Evaluation and cost accounting

Run paired tasks from the same repository snapshot and environment. Keep model and reasoning settings fixed. Use repeated runs for a smaller representative subset to expose variance; report medians, p95 latency, failures, and sample sizes. Do not tune on the held-out tasks.

Compare three variants: unmodified Codex, deterministic AlphaOptimizer, and deterministic AlphaOptimizer with Jev. Observation mode helps debug selection but does not itself prove token savings because it still delivers original results.

Measure whole-task input/output usage when the host exposes it. Otherwise label token counts as estimates and avoid presenting them as billed savings. Count schema/tool-description overhead, hook feedback, extra retrievals, continuation turns, provider requests, and lost prompt-cache benefits.

```text
Net measured API cost reduction
  = baseline task cost
  - optimized Codex task cost
  - Jev task cost
  - incremental infrastructure cost
```

Use actual configured prices and distinguish cached from uncached input. Subscription usage reductions are not automatically dollar savings. Lower input volume also does not establish lower reasoning usage or faster completion.

Required failure fixtures: lost store, disk quota, corrupt artifact, unavailable Jev, invalid classification, stale index, replayed event, concurrent sessions, partial streamed result, repeated test failures, malicious instructions embedded in logs, secret-like content, unknown result schema, and interrupted completion checks.

Treat repository content and tool output as untrusted data. Selection must not promote their instructions into trusted hook guidance. Separate fixed guidance from quoted evidence; where the host cannot preserve that boundary adequately, return retrieval handles instead of injecting arbitrary source text into privileged context.

## 7. Later work, in dependency order

1. **Duplicate prevention:** recommend existing evidence first. Suppress only allowlisted read-only duplicates with matching arguments, workspace state, freshness rules, and a recoverable prior result. Always allow an explicit user-requested recheck.
2. **Compaction ledger:** persist goals, constraints, decisions, failures, and evidence references continuously. Reinject a bounded snapshot with provenance; measure interaction with existing memory tooling.
3. **Subagent optimization:** establish assignment and inheritance controls before claiming reductions. Keep parent and child evidence namespaces separate.
4. **Browser adapters:** test each tool independently; preserve accessibility names, actionable IDs, screenshot references, errors, and expandable observations.
5. **Workflow discovery:** analyze opt-in traces for repeated patterns and propose reviewed skills or tools. Installation and execution remain separate actions.

## 8. Ordered execution checklist

- [ ] P0: Record client versions and existing hook integrations.
- [ ] P0: Prove model-visible replacement, capture completeness, and recovery.
- [ ] P0: Record the supported integration path and explicit limitations.
- [ ] P1: Scaffold contracts, configuration, fixtures, and baseline measurements.
- [ ] P2: Implement durable storage, exact retrieval, isolation, and expiry.
- [ ] P3: Implement deterministic selection and pass evidence-retention tests.
- [ ] P4: Verify Jev's API/data contract and add the bounded provider adapter.
- [ ] P4: Measure incremental benefit against deterministic-only selection.
- [ ] P5: Implement repository retrieval and stale-evidence detection.
- [ ] P6: Add advisory patch checks and revision-linked completion evidence.
- [ ] P6: Test bounded continuation, interruptions, and plan-only completion.
- [ ] P7: Package, document, and test coexistence in a disposable workspace.
- [ ] P7: Run the paired pilot and publish the results with limitations.
- [ ] P7: Enable only the capabilities that pass their gates.

The first implementation milestone is the compatibility probe and its written findings. If that passes, the next useful deliverable is deterministic output selection with reliable retrieval. Jev integration follows that baseline.

## 9. Source and verification notes

- Primary input: the user's pasted proposal, reviewed in full.
- Minimal external verification: [OpenAI hooks documentation](https://learn.chatgpt.com/docs/hooks) and [plugin architecture](https://developers.openai.com/plugins/concepts/plugins?site_locale=en), accessed 21 September 2026.
- Local verification: empty target folder and installed CLI version. No host behavior experiments, provider calls, installation, configuration changes, or performance tests were run for this planning task.
- Existing-memory integration is a precaution informed by earlier local notes; current Hindsight configuration remains to be inspected during Phase 0.
- All thresholds, file layout, contracts, phases, and success gates are proposed engineering decisions. They are not claims of existing implementation or measured benefit.
