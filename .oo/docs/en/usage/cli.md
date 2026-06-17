# CLI and Examples

## Common Commands

After installing globally, use `oneworks` directly. Without installing dependencies into the project, use `npx -p <package> <bin>` for temporary commands.

Bootstrap provides a single entry point and lazily installs the required runtime:

- `npx oneworks "read README and summarize it"`
- `npx oneworks web`
- `npx oneworks server`
- `npx oneworks app`
- `npx oneworks app cache`
- `npx oneworks app --no-cache`

`bootstrap app` passes the current shell directory to the desktop app. The same directory focuses the existing project window; a different directory starts an independent project service in the running desktop process.

Useful commands:

- `oneworks --help`
- `npx -y -p @oneworks/cli oneworks --help`
- `npx -y -p @oneworks/mcp oneworks-mcp --help`
- `oneworks`: run one task
- `oneworks --resume <sessionId>`: resume an existing CLI session
- `oneworks-mcp`: start the standalone MCP stdio server
- `oneworks-call-hook`: read a hook payload from stdin and run the hooks runtime
- `oneworks list` / `oneworks ls`: list cached task history in compact mode
- `oneworks list --view default|full`: show common columns or full context, PID, and helper command columns
- `oneworks list --running`: show only running CLI sessions
- `oneworks clear`: clear local logs and caches
- `oneworks stop <sessionId>`: gracefully stop a running CLI session
- `oneworks kill <sessionId>`: force terminate a running CLI session
- `oneworks config list [path]`: show config section state or a subtree
- `oneworks config get [path]`: read a config value
- `oneworks config set [path] [value]`: write a config value
- `oneworks config unset [path]`: delete a config value
- `oneworks accounts add <adapter> [accountName]`: run the adapter-native login flow and save the returned credentials snapshot under the project home
- `oneworks accounts show <adapter> <accountName>`: show account details and the latest quota summary
- `oneworks accounts remove <adapter> <accountName>`: remove an adapter account snapshot from the current workspace

Commands default to the project root workspace. If `__ONEWORKS_PROJECT_WORKSPACE_FOLDER__` is set, that directory is used directly. Otherwise the entry points probe upward from the current directory for `.oo`, `.oo.config.*`, `pnpm-workspace.yaml`, or a Git root. Set `__ONEWORKS_PROJECT_CONFIG_DIR__` when config files live outside the resolved workspace root.

## Built-in Skills

`@oneworks/cli` injects the companion plugin `@oneworks/plugin-cli-skills` by default. Use its skills with `--include-skill`:

- `oneworks-cli-quickstart`: explains `oneworks`, `oneworks list`, `oneworks --resume`, `oneworks stop`, `oneworks kill`, and `oneworks config list|get|set|unset`.
- `oneworks-cli-print-mode`: explains `--print`, `--input-format`, permission requests, session continuation, and `submit_input`.
- `oneworks-model-services`: explains model service provider config, built-in provider ids, default API base URLs, provider portals, model/balance/status capabilities, and safe writeback rules.
- `create-entity`: creates a new One Works entity from a user request.
- `update-entity`: updates an existing One Works entity.
- `create-plugin`: turns a desired plugin behavior into a manifest, frontend entry, server entry, and verification steps.

```bash
oneworks --include-skill oneworks-cli-quickstart "explain how oneworks CLI resumes a session"
oneworks --include-skill oneworks-cli-print-mode --print "explain permission handling in print mode"
oneworks --include-skill oneworks-model-services "help me configure the official DeepSeek model service"
oneworks --include-skill create-plugin "make a plugin that adds a screenshot button to the chat header"
```

## Examples

Start the UI:

```bash
npx oneworks web
```

Developing the One Works source repository with separate server/client:

```bash
npx -y -p @oneworks/server oneworks-server --allow-cors
npx oneworks-client
```

Open the desktop app from project directories:

```bash
cd ~/work/project-a && npx oneworks app
cd ~/work/project-b && npx oneworks app
```

Start standalone MCP:

```bash
npx -y -p @oneworks/mcp oneworks-mcp --include-category general,task
```

Debug hooks runtime:

```bash
printf '%s\n' '{"hookEventName":"Notification","cwd":"'"$PWD"'","sessionId":"debug-hook"}' | npx -y -p @oneworks/hooks oneworks-call-hook
```

Run a task:

```bash
oneworks -A codex --print "read README and suggest three improvements"
oneworks -A claude "read README and suggest three improvements"
oneworks --workspace billing "fix the order status rollback issue"
```

`-A` is the short form of the adapter parameter and accepts aliases such as `claude` and `adapter-codex`.

When scripts consume `--print` output, add `--print-idle-timeout <seconds>` as a fallback. If no adapter event arrives within the timeout, the CLI exits non-zero.

## Workspaces

Large repositories can declare `workspaces` in `.oo.config.json`. With `--workspace <id>`, the task starts in that workspace directory and loads that workspace's own config and data assets.

```bash
oneworks --workspace billing "fix the order status rollback issue"
```

See [Workspace Scheduling](./workspaces.md).

## Permission Mode Defaults

`--permission-mode <mode>` overrides the permission mode for this run. Without it, or when the Web UI is still in default mode, One Works reads `permissions.defaultMode`, for example `"bypassPermissions"`.

`--yolo` is shorthand for `--permission-mode bypassPermissions` and can be used for new and resumed sessions.

## Resume Sessions

```bash
oneworks list
oneworks list --view default
oneworks list --view full
oneworks --resume <sessionId>
oneworks --resume <sessionId> --permission-mode bypassPermissions
oneworks --resume <sessionId> --yolo
oneworks --resume <sessionId> --effort high --include-tool read_file
```

`--resume` reuses cached adapter, model, workspace, and most startup parameters. Permission mode can be overridden for the resumed run and is written back to the CLI cache for future resumes.

## Read and Write Config

```bash
oneworks config list
oneworks config get general.defaultModel
oneworks config get models
oneworks config get modelServices.gpt-responses.models
```

- `oneworks config list` / `oneworks config get` read merged config by default. Use `--source global|project|user|merged|all` to inspect another source.
- `oneworks config set` / `oneworks config unset` write project config by default. Use `--source global|project|user` to choose the target source.
- Text mode outputs YAML for readability. `--json` keeps the structured raw result.
- `oneworks config get models` and `oneworks config list models` expand `modelServices` into a service-to-model view in text mode.

## Startup Profiling

For slow startup debugging, add this to project `.oo.dev.config.json`:

```json
{
  "diagnostics": {
    "startupProfile": {
      "enabled": true,
      "log": true,
      "thresholdMs": 10
    }
  }
}
```

Or enable temporarily:

```bash
ONEWORKS_STARTUP_PROFILE=1 ONEWORKS_STARTUP_PROFILE_CONSOLE=1 oneworks "hi"
```

Logs are written under `<project-home>/logs/<ctx>/startup/`.

## Adapter Accounts

```bash
npx oneworks accounts add codex
npx oneworks accounts add codex work
npx oneworks accounts show codex work
npx oneworks accounts remove codex work
```

`oneworks accounts add` invokes the adapter account onboarding capability. Built-in support currently starts with `codex`. Codex runs `codex login` in an isolated HOME, reads the generated `auth.json`, and saves it under `<project-home>/.local/adapters/codex/accounts/<key>/`.

See [Adapter Configuration and Multiple Accounts](./adapters.md).
