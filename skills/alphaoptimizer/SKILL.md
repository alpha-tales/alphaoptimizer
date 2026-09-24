---
name: alphaoptimizer
description: Use AlphaOptimizer to capture large textual tool results, keep raw evidence retrievable, select concise deterministic excerpts, search repository evidence, and track completion criteria. Use when a task needs evidence reduction or durable retrieval rather than ordinary file reading.
---

# AlphaOptimizer

Use the AlphaOptimizer MCP tools for large textual outputs, repository evidence lookup, or explicit
criteria tracking.

The installed plugin supplies automatic hooks and code-mode instructions. Use `optimization_status`
before claiming automatic optimization is active. Missing Jev credentials, disabled modes, untrusted
hooks, and a server receiving no processing events must not be reported as working optimization.
Never request or print an API key in a tool result.

Default behavior is conservative:

- Prefer `select_evidence` only for large textual output where exact recovery matters.
- Use `read_artifact` to expand or verify original text before making claims.
- Use `search_repository` for exact, source-linked excerpts inside the active project workspace.
- Use `record_criterion` only for user-stated or clearly labeled project requirements.
- Treat `check_completion` as advisory. It reports evidence gaps; it does not prove completion by
  itself.

Do not use AlphaOptimizer to approve permissions, suppress destructive actions, or claim token/cost
savings unless the compatibility and evaluation reports prove that specific path.
