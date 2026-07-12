# Browser driver

- Added a session-scoped plugin for controlling OneWorks internal browser tabs with semantic snapshots, stable element references, screenshots, bounded waits, and serial workflows.
- Added a desktop loopback broker that authenticates each workspace runtime and keeps browser pages isolated by OneWorks session.
- Added progressive workflow results: short runs return compact step results inline, while longer runs expose step IDs for targeted detail lookup.
- Added right-side and bottom placement with the right side as the Agent default, plus a deterministic local Browser Use lab for interaction verification.
- Required explicit page IDs at both the plugin schema and desktop broker boundaries to prevent implicit tab switching in multi-tab sessions.
- Added native select actions and theme propagation for reliable form automation in light and dark desktop themes.
- Namespaced all tools for the in-app browser surface, replacing ambiguous `browser_*` and `execute_browser_*` names.
- Added `in_app_browser_show_page` to reveal an existing controlled page in its owning right or bottom panel without changing its URL.
- Added page-keyed scheduling and `execute_in_app_browser_workflows`: independent pages run concurrently while operations targeting the same page remain serial and failure-isolated.
- Added explicit tab lifecycle controls for close, duplicate, and right/bottom movement. Recreated tabs return a replacement page ID so later actions cannot silently target a stale webview.
- Added reload/stop, compact navigation state, paginated per-tab history, exact history navigation, and explicit history clearing.
- Added page view state, device preset discovery and emulation controls, native page zoom, and page-embedded DevTools without exposing arbitrary JavaScript or raw CDP.
- Added `open_mode` so Agents can deliberately reuse a matching URL or create a separate internal tab.
