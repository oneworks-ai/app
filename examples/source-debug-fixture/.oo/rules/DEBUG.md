---
description: Local source debugging rules for the One Works fixture workspace.
globs:
  - "**/*"
---

# Local Debug Rules

- Treat this workspace as disposable runtime data plus stable tracked fixtures.
- Keep generated files under `.oo/.local`, `.oo/runtime`, `.oo/caches`, `.oo/logs`, or `.logs`.
- Prefer deterministic reproduction steps with exact commands and observed paths.
- Do not add external dependencies unless a debugging scenario explicitly needs them.
