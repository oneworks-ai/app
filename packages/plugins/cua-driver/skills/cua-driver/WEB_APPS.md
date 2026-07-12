# Web Apps

Use this note when Cua Driver is controlling browsers, Electron apps, Tauri apps, WebKit views, or canvas-heavy interfaces.

- Prefer `launch_app` with `urls` for navigation.
- Prefer separate browser windows over tab switching when driving multiple pages.
- Start with `get_window_state`, then fall back to screenshot pixel coordinates if the AX tree is sparse.
- Avoid `Cmd+L` for background browser navigation; it expresses focus intent and can foreground the browser.
- Avoid `Cmd+1` through `Cmd+9`, `Cmd+]`, `Cmd+[`, `Cmd+Shift+]`, and `Cmd+Shift+[` for background tab changes.
- For form fields, use element-indexed clicks and `type_text`; use `set_value` only when the target field supports AX value writes reliably.

After each action, verify with a fresh `get_window_state` or screenshot.
