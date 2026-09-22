import { setImmediate } from "node:timers/promises";
import { Chunk, Selection } from "../contracts/schemas.js";
import { estimateTokens } from "../util/hash.js";

type SelectionOptions = {
  tokenBudget: number;
  goal?: string;
  relevantIds?: Set<string>;
  providerStatus?: string;
  signal?: AbortSignal;
};
const PATTERNS = [
  [
    "failure",
    /\b(error|failed|failure|exception|traceback|assert|timeout|timed out)\b/i,
  ],
  ["test-summary", /\b(test|spec|suite|passed|failed|skipped)\b/i],
  ["diff", /^(\+{3}|-{3}|@@|\+|-)/m],
  ["search-hit", /(^|\n).+:\d+:/],
] as const;
function block(chunk: Chunk): string {
  return `--- evidence:${chunk.artifactId}:${chunk.chunkId} lines ${chunk.startLine}-${chunk.endLine} ---\n${chunk.text}`;
}
function footer(selection: Selection): string {
  return [
    "--- alphaoptimizer selection ---",
    `mode: ${selection.mode}`,
    `estimatedTokens: ${selection.estimatedTokens}`,
    `omittedChunks: ${selection.omittedChunkCount}`,
    `reasons: ${selection.reasonCodes.join(", ") || "none"}`,
    selection.expansionCursor
      ? `expandWith: read_artifact artifactId=${selection.artifactId}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
// Cooperative generator: constant-size accounting per candidate; one ordering pass at the end.
function* select(
  chunks: Chunk[],
  options: SelectionOptions,
): Generator<void, Selection> {
  const terms = [
    ...new Set(
      (options.goal ?? "")
        .toLowerCase()
        .split(/[^a-z0-9_./-]+/)
        .filter((term) => term.length >= 3),
    ),
  ].slice(0, 128);
  const candidates: Array<{
    chunk: Chunk;
    score: number;
    reasons: string[];
    cost: number;
  }> = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i % 128 === 0) {
      options.signal?.throwIfAborted();
      yield;
    }
    const chunk = chunks[i];
    const reasons: string[] = [];
    let score = 0;
    for (const [code, pattern] of PATTERNS)
      if (pattern.test(chunk.text)) {
        score += 20;
        reasons.push(code);
      }
    if (options.relevantIds?.has(chunk.chunkId)) {
      score += 30;
      reasons.push("jev-relevant");
    }
    const lower = chunk.text.toLowerCase();
    for (const term of terms)
      if (lower.includes(term)) {
        score += 5;
        if (!reasons.includes("goal-term")) reasons.push("goal-term");
      }
    if (i === 0) {
      score += 2;
      reasons.push("leading-context");
    }
    candidates.push({ chunk, score, reasons, cost: block(chunk).length + 2 });
  }
  const selected: typeof candidates = [];
  const reasons = new Set<string>(
    options.providerStatus ? [options.providerStatus] : [],
  );
  let chars = 0;
  for (const candidate of candidates)
    if (candidate.chunk.pinnedEvidence) {
      selected.push(candidate);
      chars += candidate.cost;
      candidate.reasons.forEach((reason) => reasons.add(reason));
    }
  function metadata(count: number, reasonCodes: Set<string>): Selection {
    return {
      artifactId: chunks[0]?.artifactId ?? "",
      mode:
        count === chunks.length
          ? "passthrough"
          : reasonCodes.has("jev-used")
            ? "deterministic_with_provider"
            : "deterministic",
      selectedChunkIds: [],
      omittedChunkCount: chunks.length - count,
      reasonCodes: [...reasonCodes],
      estimatedTokens: 0,
      expansionCursor: count < chunks.length ? "all" : null,
      fallbackMode: null,
    };
  }
  function budget(chars: number, count: number, reasons: Set<string>): number {
    const state = metadata(count, reasons);
    // Resolve the token-count field's own digit width to a fixed point.
    for (let i = 0; i < 12; i++) {
      const tokens = Math.ceil((chars + footer(state).length) / 4);
      if (tokens === state.estimatedTokens) return tokens;
      state.estimatedTokens = tokens;
    }
    return state.estimatedTokens;
  }
  if (budget(chars, selected.length, reasons) > options.tokenBudget)
    reasons.add("mandatory-overflow");
  else {
    const optional = candidates
      .filter(
        (candidate) => !candidate.chunk.pinnedEvidence && candidate.score > 0,
      )
      .sort(
        (a, b) => b.score - a.score || a.chunk.startByte - b.chunk.startByte,
      );
    for (let i = 0; i < optional.length; i++) {
      if (i % 128 === 0) {
        options.signal?.throwIfAborted();
        yield;
      }
      const candidate = optional[i];
      const next = new Set([...reasons, ...candidate.reasons]);
      if (
        budget(chars + candidate.cost, selected.length + 1, next) <=
        options.tokenBudget
      ) {
        selected.push(candidate);
        chars += candidate.cost;
        candidate.reasons.forEach((reason) => reasons.add(reason));
      }
    }
  }
  const result = metadata(selected.length, reasons);
  result.selectedChunkIds = selected
    .sort((a, b) => a.chunk.startByte - b.chunk.startByte)
    .map((candidate) => candidate.chunk.chunkId);
  result.estimatedTokens = budget(chars, selected.length, reasons);
  if (result.estimatedTokens > options.tokenBudget)
    result.fallbackMode = "selected evidence exceeded budget";
  // One final render accounts for any legacy overlapping chunks after deduplication.
  for (let i = 0; i < 12; i++) {
    const exact = estimateTokens(renderSelection(chunks, result));
    if (exact === result.estimatedTokens) break;
    result.estimatedTokens = exact;
  }
  return result;
}
export function selectDeterministic(
  chunks: Chunk[],
  options: SelectionOptions,
): Selection {
  const work = select(chunks, options);
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
}
export async function selectDeterministicAsync(
  chunks: Chunk[],
  options: SelectionOptions,
): Promise<Selection> {
  const work = select(chunks, options);
  let next = work.next();
  while (!next.done) {
    await setImmediate();
    options.signal?.throwIfAborted();
    next = work.next();
  }
  return next.value;
}
export function renderSelection(chunks: Chunk[], selection: Selection): string {
  const ids = new Set(selection.selectedChunkIds);
  let end = 0;
  const blocks: string[] = [];
  for (const chunk of chunks
    .filter((chunk) => ids.has(chunk.chunkId))
    .sort((a, b) => a.startByte - b.startByte)) {
    if (chunk.endByte <= end) continue;
    const skip = Math.max(0, end - chunk.startByte);
    const text = Buffer.from(chunk.text).subarray(skip).toString("utf8");
    const startLine =
      chunk.startLine +
      (Buffer.from(chunk.text).subarray(0, skip).toString("utf8").match(/\n/g)
        ?.length ?? 0);
    blocks.push(block({ ...chunk, text, startLine }));
    end = chunk.endByte;
  }
  return [...blocks, footer(selection)].join("\n\n");
}
