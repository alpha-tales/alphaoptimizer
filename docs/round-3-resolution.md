# Third review resolution

Implemented and validated 21 September 2026. Source tree has no Git metadata.

1. **In-flight eviction:** capture creates a durable SQLite lease atomically; all quota writers and
   expiry sweeps honor it. Response construction extends protection for five minutes. Expired leases
   are reclaimed after crashes. Tests delay the provider, use another store connection and an independent
   process, exercise quota pressure, and expire the lease. Provider and selection receive cancellation.
2. **Portable package:** `.mcp.json` invokes the installed `alphaoptimizer` binary. README documents
   installation and PATH. `npm run test:package` packed the package, installed it elsewhere, and used
   its shipped command from an unrelated cwd to initialize MCP and capture evidence.
3. **Artifact retrieval:** literal case-insensitive match windows include the hit, have exact UTF-8
   byte/line ranges, report partial excerpts, and expose a query-bound cursor accepted by `read_artifact`.
   Tests cover long-line hits, multiple hits, more than 50 chunks, cursor misuse and strict Unicode byte
   budgets. Public MCP capture and two-page retrieval also passed. See operations for query semantics.
4. **Diagnostics:** record-aware pinning replaces fixed overlap. Tests vary all 40 boundary positions
   and 4/45/90 intervening diagnostic lines; expected/actual details survive and output is not duplicated.
5. **Repository edit race:** each exact hit's original ripgrep line is checked against the excerpt
   snapshot. Controlled insertion and removal before candidate reading produce a clear retry error.
6. **Selector scaling:** costs are precomputed and maintained incrementally, with cooperative yields
   and a bounded parser chunk count. Tests verify yielding and exact final budgets at 1k/4k/8k candidates.
   Local median times over five measured runs after warmup: 1.98/4.91/9.12 ms respectively. These are
   synthetic local measurements, not production latency guarantees.

Validation: 37 tests passed; application and test type checks passed; clean build passed;
installed-package and public MCP continuation smoke tests passed. No live Jev API call,
publication, license change, or desktop hook validation was performed.
