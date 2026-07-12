# @oneworks/plugin-cua-driver 0.1.0-beta.5

- Added managed semantic workflows with compact progressive results, bounded waits, checkpoints, and duplicate accessibility-node handling.
- Added session-specific virtual pointers with Agent-selectable colors, configurable starting positions, stable direct motion, and physical-mouse isolation.
- Moved the reusable rounded pointer SVG design into `@oneworks/cursor` while keeping color selection, session defaults, motion, lifecycle, and permissions inside the CUA plugin.
- Added `execute_workflows` with cross-process app-resource scheduling: different apps may advance concurrently, same-app workflows remain serial across MCP sessions, and pointer style/start/action stays globally transactional.
