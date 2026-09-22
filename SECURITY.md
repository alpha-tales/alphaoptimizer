# Security

AlphaOptimizer is intended to run as a local MCP server under the user's account. It is not a
network service and does not authenticate arbitrary remote clients.

## Threat Model

- Repository files and tool output are untrusted input.
- Artifact handles are scoped by workspace and the server-bound session. Use
  `ALPHAOPTIMIZER_SESSION_ID` when a stable session is required across restarts.
- Runtime data contains raw artifacts, chunks, criteria, and SQLite sidecars.
- External provider egress is disabled by default.

## Reporting

For now, report issues directly to the repository owner. Do not include real secrets in reports.

## Data Handling

Keep `ALPHAOPTIMIZER_DATA_DIR` private to the current user. The server rejects permissive data
directories rather than silently storing raw evidence in shared locations.
