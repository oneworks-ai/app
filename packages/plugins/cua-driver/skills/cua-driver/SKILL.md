---
name: cua-driver
description: Drive native macOS apps through the Cua Driver tools. Use when a task asks to open, inspect, click, type, scroll, capture a final screenshot, or verify a real macOS app without stealing the user's focus.
---

# Cua Driver

Use the Cua Driver MCP tools contributed by this plugin. OneWorks owns the session and agent loop; the plugin runtime owns driver installation, daemon startup, permission preflight, and the long-lived MCP transport.

## User Contract

The user only describes the desired macOS outcome. Do not ask them to run setup commands, start a daemon, resolve a binary, or check permissions. Do not expose those prerequisites as task steps. If macOS requires a new Accessibility or Screen Recording grant, explain the specific system permission and retry the original action after it is granted.

Keep the user's frontmost app frontmost. Use Cua Driver tools whenever an action touches native GUI state. Do not substitute `open`, mutating AppleScript, `cliclick`, raw desktop screenshots, or foregrounding shortcuts; those paths can activate apps, move the real cursor, switch Spaces, or bypass the driver's evidence trail.

The plugin runtime automatically prepares a visible virtual Agent pointer before exposing the tools. The physical mouse remains untouched. Each session receives its own stable automatic color. If the user requests a particular color, call `set_session_cursor_color` once for this session or pass `cursor_color` with `execute_workflow`; do not add pointer setup commands or raw cursor-style operations to the task.

## Action Protocol

Prefer `execute_workflow` whenever two or more actions are known in advance. Submit the serial steps once and let the runtime refresh state, resolve semantic targets, wait, verify, and stop at checkpoints. Use `resume_workflow` only after a returned agent/user checkpoint. Use `get_workflow_step_results` only when the compact result does not contain enough detail. Read [WORKFLOWS.md](WORKFLOWS.md) before composing a workflow.

The workflow runner prepares its own AX-only semantic observation mode. Do not call or describe configuration tools; use the separate `screenshot` tool only when pixels are actually required.

Fall back to individual tools only while exploring an unknown interface or recovering from a failed workflow:

1. Use `launch_app` or `list_apps` to obtain the target `pid`.
2. Use `list_windows` to select a `window_id`.
3. Call `get_window_state` immediately before every action.
4. Act with the fresh `element_index` when available; use coordinates from the returned screenshot only when the accessibility tree is sparse.
5. Call `get_window_state` immediately after every action and verify the intended state change.

Element indices are cached per `(pid, window_id)`. Never reuse an index across windows or after a material state change without another `get_window_state` call.

Available tools include `execute_workflow`, `resume_workflow`, `get_workflow_step_results`, `set_session_cursor_color`, `launch_app`, `list_apps`, `list_windows`, `get_window_state`, `screenshot`, `click`, `right_click`, `double_click`, `scroll`, `type_text`, `press_key`, `set_value`, `zoom`, and read-only runtime state tools. The OneWorks MCP safety profile intentionally does not expose physical-cursor movement, drag gestures, focus-sensitive hotkeys, browser scripting, raw cursor/config mutation, trajectory replay, or child-session recording. Call `press_key` without `window_id`; window-targeted key delivery can activate the target app and is rejected by the proxy.

## Browsers And Web Apps

For URL or file handoff, use `launch_app` with `bundle_id` and `urls`. Avoid browser focus shortcuts such as `Cmd+L` and tab switching when the browser is not already the user's intended foreground app.

Chromium, WebKit, Electron, Tauri, canvas-heavy apps, games, and design tools can expose sparse accessibility trees. When that happens, use the current state screenshot and pixel actions while preserving the before/after state protocol.

## Evidence

This skill never starts or finalizes a recording. When a parent task needs a demo or regression video, the outer orchestrator owns system-display capture so it can prove the visible Agent pointer and the user's unchanged foreground app. Do not reinterpret an outer recording request as an instruction for this child session.

When the user explicitly asks this session for a final still image, use `screenshot` after the final state has been verified and save it under `/private/tmp/oneworks-cua/` unless another destination was requested. A trajectory slideshow is diagnostic data, not evidence of live pointer motion.
