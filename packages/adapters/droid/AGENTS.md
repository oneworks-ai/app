# Factory Droid adapter

This package owns the Factory Droid native `stream-jsonrpc` runtime, isolated Factory home, managed CLI preparation, protocol projection, and native hook bridge.

- Keep One Works as the task/worktree orchestrator. Do not enable Droid worktrees, Missions, or worker mode here.
- Treat `FACTORY_PROTOCOL_VERSION` as an explicit compatibility boundary; missing or mismatched response versions are fatal.
- The runtime may consume session-scoped skills, MCP servers, instructions, and hooks. It must not install Factory plugins or read/copy the user's Factory credentials.
- Native history import remains in `apps/server/src/services/runtime-store/history-import.ts`; fixtures must follow the official SDK JSONL shape and stay credential-free.

Verify with the package Vitest suite plus the repository adapter/config/registry/history contract tests.
