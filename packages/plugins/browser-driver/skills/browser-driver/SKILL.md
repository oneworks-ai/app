---
name: browser-driver
description: Control the current OneWorks session's internal browser tabs with semantic snapshots, reliable element refs, screenshots, waits, and page-safe concurrent workflows.
---

# OneWorks Browser Driver

Use this skill for websites shown in the OneWorks internal browser. It does not control external Chrome or native desktop applications.

Prefer `execute_in_app_browser_workflow` when one page has two or more deterministic steps. When independent work is ready for multiple pages, submit it once with `execute_in_app_browser_workflows`; pages run concurrently while each page remains serial. Use low-level tools only to inspect, recover from a changed page, or perform a single action.

1. Use `in_app_browser_open` when the requested page is not already open. It reuses the same URL by default; pass `open_mode: "new-tab"` only when the task needs a separate page instance. Pages open on the right by default; pass `placement: "bottom"` only when a wide horizontal panel better suits the task. Call `in_app_browser_list_pages` only when you need to discover existing pages. Use `in_app_browser_show_page` to reveal an existing page when the user needs to see it; ordinary background operations should continue addressing the page directly by `page_id` without changing the visible tab.
2. Call `in_app_browser_snapshot` before referring to page elements. Keep its `page_id` paired with every returned `ref`; do not invent CSS selectors or coordinates. Every page operation requires an explicit `page_id`, so never rely on an implicit active tab.
3. A ref can become stale after navigation or DOM updates. If a tool returns `TARGET_NOT_FOUND`, take a new snapshot and continue with the new ref.
4. Prefer `in_app_browser_wait` with an expected text/ref over a fixed delay. Do not add shell sleeps. After an action, request only the cheapest state needed for the next decision; do not take both a snapshot and screenshot by default.
5. Workflows run serially against an explicit `page_id`. Give every step a stable `node_id`. Use `missing: "skip"` only when absence is an expected exit condition; otherwise keep the default `stop`. Batch only independent page workflows; steps targeting the same page are deliberately queued.
6. For one to three single-workflow steps, results are returned inline. Longer workflows and all multi-page batches return `run_id` and step IDs; call `get_in_app_browser_workflow_steps` only for the details needed. Tab management, history clearing, and paginated history reads remain explicit low-level calls and are not workflow steps.
7. Use `in_app_browser_get_navigation_state` for the cheap current index/loading/back-forward summary. Call `in_app_browser_get_navigation_entries` only when entry details are needed. `in_app_browser_navigate_history` accepts exactly one of `direction`, `offset`, or `index`.
8. Treat returned `page.id` / `replacement_page_id` from `in_app_browser_duplicate_page` or `in_app_browser_move_page` as authoritative; those actions may recreate the webview. Do not keep using `previous_page_id`. Closing a page is terminal for `closed_page_id`.
9. Before choosing a simulated device, call `in_app_browser_list_device_presets`. Use `in_app_browser_set_device_mode` for the device toolbar and emulation, `in_app_browser_set_page_zoom` for native page zoom, and `in_app_browser_set_embedded_devtools` only when inspection is materially useful. Read the applied state with `in_app_browser_get_page_view_state`.
10. Use `in_app_browser_screenshot` only when visual verification is material. The tool returns a local PNG path. Use `in_app_browser_select` for native HTML selects instead of simulating popup clicks and arrow keys.

The plugin intentionally does not expose arbitrary JavaScript, raw CDP, cookies, storage, saved passwords, or OneWorks application chrome.
