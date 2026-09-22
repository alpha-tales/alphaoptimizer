---
name: alphaoptimizer
description: Use AlphaOptimizer to capture large textual tool results, keep raw evidence retrievable, select concise deterministic excerpts, search repository evidence, and track completion criteria. Use when a task needs evidence reduction or durable retrieval rather than ordinary file reading.
---

# AlphaOptimizer

Use the AlphaOptimizer MCP tools for large textual outputs, repository evidence lookup, or explicit
criteria tracking.

Default behavior is conservative:

- Prefer `select_evidence` only for large textual output where exact recovery matters.
- Use `read_artifact` to expand or verify original text before making claims.
- Use `search_repository` for exact, source-linked excerpts inside an allowed workspace.
- Use `record_criterion` only for user-stated or clearly labeled project requirements.
- Treat `check_completion` as advisory. It reports evidence gaps; it does not prove completion by
  itself.

Do not use AlphaOptimizer to approve permissions, suppress destructive actions, or claim token/cost
savings unless the compatibility and evaluation reports prove that specific path.
