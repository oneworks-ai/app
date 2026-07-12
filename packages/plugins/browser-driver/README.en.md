# @oneworks/plugin-browser-driver

Agent control for the OneWorks internal browser. It operates interaction-panel webviews through a desktop-managed, workspace/session-scoped broker, so users never configure a debug port or launch an external browser.

The plugin exposes `in_app_browser_*` semantic tools, serial per-page workflows, and concurrent multi-page workflows. `in_app_browser_open` opens on the right by default, can explicitly target the bottom, and uses `open_mode` to reuse a matching URL or force a new tab. Every later page operation requires its exact `page_id`, so multiple tabs never fall back to an implicit active page.

Page-scoped capabilities include showing, closing, duplicating, and moving tabs between the right and bottom panels; reloading, stopping, moving backward or forward, navigating by history index or offset, paginating history, and clearing the current tab history; reading page view state; listing device presets and configuring device mode; setting native page zoom; and opening or closing DevTools embedded in the page view. `in_app_browser_show_page` only reveals the existing tab. Duplicate and cross-area move return a new `page.id` / `replacement_page_id`, which must be used by later calls.

`execute_in_app_browser_workflows` runs independent pages concurrently while preserving serial order within each page. Workflows include only page-local operations with compact results; closing, duplicating, moving, clearing history, and listing full history remain explicit one-shot calls. The plugin does not expose arbitrary JavaScript, raw CDP, cookies, storage, saved passwords, or OneWorks shell pages.

```json
{
  "plugins": [
    { "id": "browser-driver", "scope": "browser" }
  ]
}
```

The scoped skill name is `browser/browser-driver`.
