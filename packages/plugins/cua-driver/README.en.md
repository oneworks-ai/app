# @oneworks/plugin-cua-driver

This is OneWorks' thin integration for [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver), the background macOS computer-use driver. OneWorks remains responsible for the model, sessions, agent loop, cancellation, and logs. The plugin projects the native GUI tools into sessions as an MCP asset and prepares the runtime when that MCP process starts.

The plugin does not embed Cua's agent loop.

## What it provides

- a `cua-driver` skill for observing, operating, and verifying real macOS apps
- a scoped Cua Driver MCP asset that projects the native tools into the active adapter
- `cua-driver` and `ow-cua-driver` package bins that install or delegate to the real CLI
- narrowed install and uninstall scripts that only manage `CuaDriver.app` and the CLI link created by the plugin
- `manager` and `workspace` server runtimes for status, path lookup, explicit preparation, and launcher search
- a visible Agent pointer synchronized with actions without moving the user's physical mouse; workflows start from the main-display center by default and agents may choose logical start coordinates
- procedural `execute_workflow` for submitting predictable serial steps once while the runtime refreshes window state, resolves semantic targets, waits, and verifies
- `resume_workflow` and `get_workflow_step_results` for checkpoint recovery and progressive `run_id + step_id` detail lookup
- generic `toolUsePresentations` metadata for localized tool titles, action icons, compact targets, and structured details

## Install and enable

```bash
pnpm add -D @oneworks/plugin-cua-driver
```

Enable it in `.oo.config.json` or `.oo.config.yaml`:

```json
{
  "plugins": [
    {
      "id": "cua-driver",
      "scope": "cua"
    }
  ]
}
```

With that scope, the skill is exposed as `cua/cua-driver`. Without a scope, use `cua-driver`.

Package installation makes a best-effort attempt to install the signed `CuaDriver.app` on macOS outside CI. To skip it:

```bash
ONEWORKS_CUA_DRIVER_SKIP_POSTINSTALL=1 pnpm install
```

Normal usage requires no manual preparation. The agent only invokes the `cua-driver` skill; before MCP tools become available, the plugin installs missing components, prepares its background service, checks permissions, and enables the virtual Agent pointer. By default, the plugin deterministically assigns a different color to each OneWorks session. The Config tab can switch to a fixed default, while an agent may choose any valid hex color for its current session. Every workflow starts from the main-display center when `cursor_start` is omitted; an agent may pass logical main-display coordinates or use `set_session_cursor_start` before the next low-level pointer action. The plugin dynamically generates a safe rounded SVG with a contrasting border and applies it only immediately before that session clicks. `ensure` remains available only for diagnostics and repair:

```bash
ow-cua-driver ensure
```

`ensure` installs the app when missing, verifies the runtime, and requests an Accessibility and Screen Recording permission check. If the background service is unavailable, the plugin recovers it automatically; if recovery fails, it exits with an actionable error instead of returning a false ready state. macOS TCC grants still require user confirmation under System Settings → Privacy & Security. The plugin names each missing permission; retry the original task after granting it.

## Execution environment usage

When enabled, the user only describes the desired outcome. OneWorks automatically projects the plugin MCP asset into the session. Prefer one `execute_workflow` call for multiple predictable actions; use low-level tools such as `launch_app`, `get_window_state`, and `click` only for unknown-interface discovery or recovery. The agent must not expose `ensure`, background-service startup, path resolution, permission checks, or pointer setup as user task steps. The wrapper performs one controlled preflight before the MCP long-lived connection is established. Background AX actions do not move the physical mouse; users instead see the virtual Agent pointer maintained by the plugin.

Workflow results adapt to size: up to three small steps are returned inline, while longer runs return step ids for selective lookup through `get_workflow_step_results`. Full traces stay out of the Agent context by default and run state remains local to the current MCP session.

The workflow runtime procedurally pins AX semantic observation once per MCP session so upstream screenshot/SOM parsing differences cannot affect target resolution. This internal configuration capability is never exposed to the Agent; use the separate `screenshot` tool when pixel evidence is required. Because the upstream Agent pointer style is daemon-global, the plugin serializes “apply this session's style + set its start + pointer action” across processes so concurrent sessions do not cross colors or starts; non-pointer operations remain concurrent.

The outer orchestrator owns system-display capture for demos, screen recordings, and regression evidence; the tested session only performs and verifies the native-app operation. This is the only path that can prove both a live virtual Agent pointer and an unchanged foreground app. Upstream trajectories, `cursor.jsonl`, and per-action screenshots remain diagnostic data and are not presented as live-pointer video evidence. When the user explicitly wants only a final still, the tested session may save a standalone window image through `screenshot_out_file`.

## Plugin runtime

`plugin.json` declares both `manager` and `workspace` server roles:

- `workspace` exposes `status`, `driver-path`, `ensure`, and the scoped `status` API to the current project
- `manager` exposes the same device-level commands and contributes status/preparation actions to the desktop launcher

Scoped commands:

- `status`: read-only install-path and background-service status; never installs
- `driver-path`: read-only resolution of the current driver binary
- `ensure`: explicitly prepare the runtime using plugin-managed defaults
- `launcher.search`: provide launcher results and invocation actions

Scoped API:

```text
GET /api/plugins/<scope>/proxy/status
```

The API includes title, description, input, output, and header schema metadata in plugin details.

## Safety boundaries

- postinstall only runs best-effort on macOS, outside CI, when the app is missing
- the installer does not modify global Codex, Claude, or OpenCode skills and does not register MCP
- `ow-cua-driver uninstall` does not delete user config, recordings, MCP configuration, or TCC grants
- set `CUA_DRIVER_VERSION` to pin another upstream release; the default is the version validated with this plugin

## Verification

```bash
pnpm -C packages/plugins/cua-driver typecheck
pnpm -C packages/plugins/cua-driver build
node packages/plugins/cua-driver/bin/cua-driver.cjs wrapper-help
```
