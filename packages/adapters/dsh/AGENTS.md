# DSH Adapter

This package adapts DeepSeek AI's official DSH automation ACP server to One Works.

- `src/runtime/install.ts` owns the exact official npm composition and managed-cache validation.
- `src/runtime/prepare.ts` owns the generated Cordis composition, isolated DSH homes, child environment, and redaction boundary.
- `src/runtime/session.ts` owns ACP initialize/new/prompt/cancel, permission requests, event projection, and process settlement.
- DSH ACP currently supports fresh text sessions only. Resume, MCP, images/audio, and native history must remain explicitly unsupported until the upstream protocol advertises and verifies them.

Read `.oo/rules/ADAPTERS.md`, `.oo/rules/adapter-design/README.md`, and `.oo/rules/maintenance/process-environment.md` before changing runtime behavior.
