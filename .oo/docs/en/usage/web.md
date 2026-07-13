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

Appearance preferences such as the primary color, theme mode, and chat history timeline display are stored in the global `appearance` section and apply across workspaces. The history timeline can use compact `Event lines` or the original `Nodes` view; `Event lines` remains the default when the option is unset.

## Local Media in Chat Markdown

Local media referenced by an agent response can be previewed safely inside the chat message. Markdown images and ordinary image links render as images; common video and audio links render with controls, fill the available message width, and support seeking. Small images keep their intrinsic size instead of being enlarged. In the shared Web client, playback uses a same-origin launcher route that forwards only to the selected workspace's fixed media endpoint. Access is limited to the current session workspace and One Works artifacts under `/tmp/oneworks-cua`. Other absolute paths, directories, device files, and escaping symlinks are rejected. Remote HTTP(S), anchor, and non-media links keep their existing behavior. A failed media load switches once to a clear fallback link instead of retrying indefinitely.

## Chat Markdown Link Intents

OneWorks uses standard Markdown's optional title field to declare an explicit opening behavior. Links without an intent continue to follow the `messageLinks` configuration.

```md
[Open inside OneWorks](https://example.com "oneworks:open=internal")
[Open in the default browser](https://example.com "oneworks:open=external")
[Open a workspace text file](apps/client/src/App.tsx "oneworks:open=workspace-file")
```

- `internal` accepts HTTP(S) only and opens in the interaction-panel iframe on Web or webview on Desktop.
- `external` accepts HTTP(S) only and uses the system default browser on Desktop or a separate browser tab on Web.
- `workspace-file` accepts only a file inside the current workspace, preferably as a relative path, and opens it in the OneWorks file tab. It does not grant access to arbitrary local files.
- Intents select the default action but never bypass URL, workspace-path, or local-media proxy security checks. The context menu can still choose another available opening action.

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
