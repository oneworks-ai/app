# Web UI and Terminal View

## Start the Web UI

The simplest project entry point is:

```bash
npx oneworks web
```

It starts a built-in server and serves the Web UI, usually at:

```text
http://127.0.0.1:8787/ui/
```

For headless or remote setups, start the server separately:

```bash
npx oneworks server --host 0.0.0.0 --port 8787 --allow-cors
```

Then connect from a standalone client or PWA.

## Configuration Pages

The Web UI can edit global, project, and local configuration sources. The main configuration pages expose adapter accounts, model services, channels, MCP servers, plugins, worktree environments, and general preferences. Inherited values are shown as inherited until you explicitly override them in the current source.

Simple scalar fields can be edited directly. Whole-field collections, JSON objects, and inherited collection entries require an explicit override action before saving to the current source.

## Worktree Environment Scripts

Each environment directory can provide:

- `create.sh`, `create.macos.sh`, `create.linux.sh`, `create.windows.ps1`
- `start.sh`, `start.macos.sh`, `start.linux.sh`, `start.windows.ps1`
- `destroy.sh`, `destroy.macos.sh`, `destroy.linux.sh`, `destroy.windows.ps1`

Windows also supports `.cmd` and `.bat` variants. Generic scripts run before platform-specific scripts. Scripts receive variables such as `ONEWORKS_WORKTREE_ENV`, `ONEWORKS_WORKTREE_OPERATION`, `ONEWORKS_WORKTREE_PATH`, `ONEWORKS_SESSION_ID`, `ONEWORKS_WORKTREE_SOURCE_PATH`, `ONEWORKS_REPOSITORY_ROOT`, `ONEWORKS_WORKTREE_BASE_REF`, and `ONEWORKS_WORKTREE_FORCE`.

Project environments are saved under `.oo/env/<environment-id>/`. Local user environments are saved under `.oo/env.local/<environment-id>/` and are ignored by Git.

## Terminal View

The `terminal` view opens an interactive shell inside the current workspace context.

- A session page can have multiple terminal panes.
- The `+` button creates a pane; the adjacent dropdown selects the shell type.
- Clear screen shortcut: `Cmd+K` on macOS / iPadOS, `Ctrl+K` on Windows / Linux. It clears frontend output and does not send shell control characters.
- On macOS / iPadOS, `Option` acts as terminal Meta inside the terminal input. Word navigation in ordinary shell input uses rendered-line boundaries; alternate-screen programs such as vim and tmux keep standard Alt-arrow sequences.
- Full screen mode lets the terminal dock cover the session content area.
- The pane manager supports title editing, hover-to-close, and drag ordering.
- The frontend renders with `xterm.js`.
- The backend uses a dedicated terminal websocket channel rather than the chat `WSEvent` stream.
- Pane title, shell type, and order are saved in browser `localStorage`.
- Scrollback and socket lifetime live in server runtime memory and are not persisted into chat `messages`.

## Requirements

- `__ONEWORKS_PROJECT_WORKSPACE_FOLDER__` should point at the project you want to operate on. Without it, the server probes upward from the current directory.
- The server process must be able to start a shell in that workspace. Without PTY support, the interactive experience degrades.
- Terminal colors follow Web UI light/dark tokens.

## Troubleshooting

- If the terminal view does not open, confirm the `sessionId` exists through `/api/sessions`.
- If it opens but does not interact, check browser focus, the terminal websocket, and server shell / PTY startup.
- If only background or colors look wrong, inspect `.chat-terminal-view__surface`, `.xterm-viewport`, and the terminal renderer background instead of only the outer container.
