# Desktop App

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../images/desktop-chat-dark.png">
  <img alt="Desktop app session page" src="../../images/desktop-chat-light.png">
</picture>

## Get an Installer

If you do not want to start from source, install the desktop app directly:

- Download the artifact for `pkg/oneworks-desktop/v*` from [GitHub Releases](https://github.com/oneworks-ai/app/releases).
- macOS: Intel (`x64`) and Apple Silicon (`arm64`) each provide `.dmg` and `.zip`.
- Windows: official installers are not published yet. Follow [#161](https://github.com/oneworks-ai/app/issues/161).
- Linux: `.AppImage`, `.deb`, and `.tar.gz`.

Current desktop builds are unsigned by default. macOS may show a first-launch security warning.

## Project Selection and Multiple Windows

The desktop app always works inside a workspace. When launched without a project, it asks you to choose a recent project or open a directory.

When started from a project directory with:

```bash
npx oneworks app
```

the current directory is passed as the workspace.

Runtime behavior:

- Re-running `bootstrap app` in the same directory focuses the existing project window.
- Running it from another directory starts a separate service for that project in the same desktop process and opens another project window.
- Each project service has its own server port and runtime state.

## Connection Model

The desktop shell starts or connects to a project service, then renders the Web UI against that service. The desktop app is responsible for project window management, native menus, launcher entry points, and platform integration. The chat session, terminal view, plugin UI, configuration pages, and runtime APIs are still served by the project service.

## Runtime Boundary

- Desktop preferences such as launcher shortcuts, icon style, and module update channels are stored in the global config `desktop` section.
- App appearance preferences, including theme and chat history timeline display, are stored in the global config `appearance` section and apply across workspaces.
- Recent projects are stored in Electron `userData` as runtime state.
- Project configuration, rules, skills, plugins, sessions, and adapter accounts are still resolved from the selected workspace and project home.
- Module updates for adapters, server, client, Web shell, and plugins take effect after the relevant runtime restarts.
