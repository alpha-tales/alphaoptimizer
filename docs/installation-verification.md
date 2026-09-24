# Installation verification — 24 September 2026

## Implemented

- Filtering defaults on; explicit off/observe settings are preserved.
- Plugin packages contain PostToolUse and SessionStart hooks.
- Code-mode policy ships in session hooks and MCP initialization instructions; no user AGENTS.md edit.
- The source launcher prepares locked production dependencies automatically in a writable cache.
- Platform bundles include Node, its license notices, and native dependencies; no global executable is required.
- Status distinguishes missing configuration from awaiting event verification. It never exposes the key.
- Node support includes 22 and 24. Workspace lists use the operating system's path delimiter.
- Host probes use Node emitters and discover the advertised fixture MCP tool name.
- Synthetic Jev responses keep compatibility tests offline from the provider.

## Verified locally

macOS arm64: 70 tests pass on Node 22.17.0 and Node 24.21.0. Build and test type checks pass.
Packed-package and fresh-cache startup pass; the latter starts without preinstalled dependencies.
The bundled Node executable initializes SQLite and the MCP server with an empty PATH and a
synthetic key. The directly configured CLI integration filters native MCP and code-mode output.
See automatic-hook-probe.json for the direct integration receipt.

## Release blockers

The isolated installed-plugin probe fails: installation succeeds, but the subsequent synthetic
Codex turn receives the original fixture output and records no AlphaOptimizer processing events.
This was reproduced with CLI 0.149.0 and 0.156.1. This does not yet distinguish a host limitation
from a missing installation/integration requirement. Do not label the installed plugin active.
See plugin-hook-probe.json. Reproduce after building a bundle with `npm run compat:plugin`.
The test uses a disposable Codex home and invocation-only hook trust bypass; it changes no real
user configuration. It does not validate the desktop trust UI.

Windows and Linux builds/runs have not been executed locally. The six-job OS/Node CI matrix
must pass, including the installed-plugin probe, before its release artifacts are uploaded.
The workflow is added in source; it has not run on GitHub in this task.

Codex requires hook trust independently of plugin installation. Native shell results lacking
exit status remain unchanged; the code-mode bridge preserves and supplies status. This is not
a promise to reduce every output. Existing explicit off overrides remain respected on upgrade.

No release was published and no installed user plugin was replaced during this work.
