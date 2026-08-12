# Grok Build CLI Adapter

The `grok` adapter uses xAI's official Grok Build CLI. One Works uses a stable `$GROK_HOME` for the project so native sessions can resume across worktrees and runtime contexts while inheriting login credentials and the base `config.toml` from the real Grok home under managed session policy.

## Configuration

```yaml
adapters:
  grok:
    cli:
      source: managed
      version: 1.0.3
    effort: high
    disableAutoUpdate: true
    disableMemory: false
    disableSubagents: false
    disableWebSearch: false
    configContent:
      ui:
        screen_mode: minimal
```

## Runtime behavior

- Managed mode installs `@xai-official/grok`; `cli.source: system` and `cli.source: path` can select an existing `grok` binary.
- Native model names are passed to `--model`. A shared `service,model` selection becomes a session-level Grok custom model using the `chat_completions`, `responses`, or `messages` backend.
- Selected MCP servers are written to `mcp_servers` in the session `config.toml`, and selected skills are projected into `$GROK_HOME/skills`.
- System prompts, permission mode, effort, and tool include/exclude filters use native Grok CLI arguments.
- Hook plugins use Grok's native `PreToolUse`, `PostToolUse`, and `Stop` events. `PreToolUse` remains blockable, and generic bridge events are deduplicated.
- Auto-update checks are disabled by default. Memory, subagents, and web search stay enabled unless the corresponding `disable*` option is true.

## Session migration and import

The session home uses a project-shared stable path. On resume, One Works migrates the matching native UUID from a legacy context-scoped home or the real `$GROK_HOME`, so the conversation remains resumable after switching worktrees or runtime contexts.

The External Sessions panel scans `$GROK_HOME/sessions` (normally `~/.grok/sessions`) and can preview and import native Grok history for the current project. Imported copies remain read-only.

## Login

One Works does not currently expose a Grok multiple-account API. Use the native `grok login` and `grok logout` commands to change the CLI login state.

See [Adapter CLI Installation and Versions](./adapter-cli.md) for managed version pinning, warmup, and environment overrides.
