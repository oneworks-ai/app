# Browser Driver Plugin

This package controls only OneWorks interaction-panel browser webviews through the authenticated desktop broker.

- `bin/browser-driver.cjs`: MCP transport, in-app-browser-prefixed semantic tools, page-keyed scheduling, compact results, screenshots, and progressive step lookup. Operations are serial within one `page_id`; independent pages may run concurrently.
- `bin/browser-driver-page-tools.cjs` owns lifecycle, history, view, device, zoom, and embedded DevTools schemas. `bin/browser-driver-interaction-tools.cjs` owns semantic page interaction schemas; workflow schemas and runtime validation stay in the `browser-driver-workflow-*` modules.
- Page lifecycle operations are explicit: `show`, `close`, `duplicate`, and `move` go through the owning host-window/panel-tab identity. Background page operations must not implicitly change the active tab. Duplicate/move can replace the underlying webview, so their returned page ID is authoritative.
- Navigation state and entries are per-tab. Keep entries paginated, keep clear-history explicit, and require exactly one target mode for history navigation (`direction`, `offset`, or `index`).
- Device presets/mode, native page zoom, and embedded DevTools are view controls. Keep them semantic and bounded; do not turn them into raw Electron/CDP escape hatches.
- `mcp/browser-driver.json`: projects the MCP process into Agent sessions. The desktop broker URL, token, and OneWorks session id are inherited from the session runtime; never ask users to configure them.
- `skills/browser-driver/`: workflow-first browser task guidance. Keep broker setup, authentication, target isolation, retries, and result storage out of the skill.
- Do not expose arbitrary JavaScript evaluation, raw CDP commands, cookies, storage, password values, or OneWorks shell webContents.
- A page ref is snapshot-scoped. On `TARGET_NOT_FOUND`, take a new snapshot instead of guessing a selector.
- Keep tool names explicit about the controlled surface: low-level tools use `in_app_browser_*`; workflow tools use `execute_in_app_browser_*` and `get_in_app_browser_*`. Do not add ambiguous `browser_*` or `execute_browser_*` aliases.
- Workflow steps may include page-local operations with compact results. Do not add page close/duplicate/move, clear-history, full history reads, arbitrary scripts, or raw protocol calls to the workflow whitelist.

Run `pnpm -C packages/plugins/browser-driver test` and the repository typecheck after changing the plugin contract.
