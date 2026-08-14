# @oneworks/adapter-goose 1.0.0-rc.3

- Add first-class Goose CLI support over the official ACP stdio boundary, including persistent native session resume, structured text/tool/permission events, cancellation, selected skills, MCP, system prompts, and isolated configuration.
- Add fail-closed official release installation with exact platform assets, mandatory SHA-256 verification, safe extraction, atomic replacement, and final version probing.
- Add read-only Goose External Sessions preview/import through the public `session list` and `session export` commands, with project ownership, native ids, tool results, and repeat-import deduplication. Goose SQLite state is never read.
- Keep unsupported Goose recipes, native hooks, SSE MCP, and subagent history explicit rather than simulating compatibility.
- Make global native-history auto-import best effort for an unavailable optional Goose CLI while preserving strict explicit selection, truthful public-export sizes, and unsupported-kind diagnostics.
- Map normalized One Works permission decisions back to exact Goose ACP option ids, bound startup/close RPCs, filter SSE before runtime preparation, and redact credentials across the final event, task-hook, and runtime-cache boundaries while hiding isolated paths from user-visible payloads.
- Scrub config-only model-service credentials from every persistent runtime view while preserving child-only delivery, bound Goose history preview to filtered metadata pages under one CLI resolution and aggregate deadline, distinguish unsupported Subtasks scope from empty history, disclose public-export preview content, and clarify that size limits skip automatic imports while manual import can override them.
