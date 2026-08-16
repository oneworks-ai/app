# @oneworks/adapter-droid 1.0.0-rc.4

- Add a first-class Factory Droid CLI adapter using strict native `stream-jsonrpc` negotiation, incremental messages, tool/interaction events, cancellation, and native session resume.
- Isolate Factory runtime state while mapping selected skills, MCP servers, system instructions, and native hooks without copying credentials or installing unsupported plugins.
- Add fail-closed, read-only preview and import for Factory SDK session history, including native ids, project scoping, worker sessions, parent chains, and deduplication.
- Drain child stdout through pipe close with a bounded fallback, terminate fatal outbound RPC failures once, and redact Factory credentials from all adapter diagnostics and lifecycle logs.
- Enforce the supported Droid version range for explicit binaries, correlate hooks by native `hookId`, and reject symlinked history source roots.
