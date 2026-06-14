# One Works 0.1.0-alpha.0

- Prefer compatible system Codex CLI installs while keeping the managed install fallback.
- Show Codex CLI preparation status in sessions so first-run installs are visible.
- Keep optimistic first user messages visible until their real runtime projection arrives.
- Launch server-side runtime consumers through the internal run entrypoint so user prompts are not prefixed with command names.
- Align chat workbench sender spacing, panel empty-state actions, side-panel tabs, and workspace drawer resource actions.
- Move the launcher workflow behind server APIs, add manager/workspace server modes, and expose the launcher overlay from web workspaces.
- Stabilize workspace-scoped web routes, project-server runtime environments, launcher selection, dock tab activation, and embedded route chrome.
- Align embedded web toolbar sizing, hover, menu, disabled tooltip, and design-standard documentation with shared chrome and overlay tokens.
- Keep interaction panel child-session composers aligned with primary session sender chrome while preserving child-specific collapsed status bar and placeholder behavior.
- Add a pinned current-session preview dock over fullscreen workspace drawers with matching chrome dividers, blur, and enter/exit animation.
- Allow the homepage PWA preview to run from the official `oneworks.cloud` domain and update public PWA/docs links to canonical URLs.
- Preserve homepage preview query parameters when entering the PWA launcher and refresh service worker caches after PWA deployments.
