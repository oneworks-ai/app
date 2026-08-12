# Grok Adapter Guide

This package adapts the official Grok Build CLI to One Works.

- `src/runtime/config.ts` owns session-scoped `$GROK_HOME`, native TOML, model-service, MCP, skill, credential, and hook projection.
- `src/runtime/migration.ts` moves a matching native Grok UUID from the real or legacy context-scoped home into the stable project-shared session home before resume.
- `src/runtime/session/` owns direct and `streaming-messages-json` subprocess lifecycles.
- `src/protocol/` maps Grok's Anthropic-compatible NDJSON to One Works events.
- `src/runtime/native-hooks.ts` and `src/hook-bridge.ts` own native `PreToolUse` / `PostToolUse` / `Stop` integration.
- `src/paths.ts` keeps the npm launcher and its downloaded native binary in project-shared cache paths; never expand the native binary per session.

Read `.oo/rules/ADAPTERS.md` and `.oo/rules/adapter-design/native-assets.md` before changing runtime behavior.
