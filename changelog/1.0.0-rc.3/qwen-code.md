# @oneworks/adapter-qwen-code 1.0.0-rc.3

- Add managed Qwen Code 0.21.11 CLI execution with native stream-json projection, partial messages, tools, cancellation, and exact native session resume.
- Isolate `HOME`, `QWEN_HOME`, and `QWEN_RUNTIME_DIR`; stage selected system instructions, skills, MCP servers, and native hooks without copying or linking credential files from the real Qwen home.
- Add fail-closed OpenAI Chat Completions model-service routing. Anthropic, Gemini, and custom provider IDs remain unsupported for the verified 0.21.11 executable contract.
- Add read-only preview and idempotent import for verified Qwen `chats` and `subagents` history, preserving native IDs, project ownership, tool results, and parent-child relationships.
- Bound native-history preview and import to a truthful 50 MiB per-file and aggregate safety limit, with race-safe opened-file identity checks and explicit skip diagnostics.
- Redact credentials from persisted adapter state and child-derived diagnostics, including exact short values in arbitrary MCP header assignments, without rewriting unrelated text.
