# @oneworks/adapter-cline 1.0.0-rc.4

- Add a first-class Cline CLI adapter using the public ACP entry point, with structured incremental text/tool events,
  permission bridging, cancellation, exact `3.0.54` native-session resume, and a conservative structured fresh-only
  fallback for non-gated system/path binaries.
- Isolate Cline home, configuration, and project-native session data; use only verified provider flags, keep native
  authentication inheritance unsupported, bootstrap advertised ACP authentication before create/load, and allow only
  explicit process-only credentials for a verified selected provider. Native Bedrock/Vertex variables do not replace
  the required ACP authentication result. Stage selected skills plus append-only system instructions.
- Add fail-closed read-only preview/import for Cline SQLite session history and messages artifacts, preserving native
  ids, project ownership, and parent/subagent relationships without fabricating unavailable image or tool results;
  the importer gates the exact released artifact discriminator and uses matching preview/import size limits.
- Keep streaming text cumulative only within a contiguous chronological segment, reconcile fresh JSON final output,
  deduplicate replay by native identity rather than text equality, and settle stopped children only after process exit.
- Reject dangling or ambiguous history parents and tool results that do not follow one unique retained native tool use.
- Keep interactive authentication choice and browser-based ACP authentication outside the short control-RPC deadline
  while preserving explicit cancellation,
  and reconcile source-scoped parent/subagent links across incremental parent-first or child-first history imports.
- Settle startup EOF, process exit, transport failure, and rejected initialize/new/load requests exactly once, and do
  not retain an already-exited server runtime before a retry.
