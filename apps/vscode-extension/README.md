# One Works VS Code Extension

en-US | [zh-Hans](./README.zh-Hans.md)

This package is a thin VS Code shell for the existing One Works Web UI.

## Local Use

From the repository root:

```bash
pnpm -C apps/vscode-extension build
```

Run the extension from VS Code and open One Works from the right Secondary Side Bar, or execute `One Works: Open Workspace`.

The extension starts one local One Works web runtime per selected workspace folder through `oneworks web`, disables local web auth, and opens the integrated client inside a VS Code right sidebar webview. Multiple workspace folders can keep separate servers running while the right sidebar shows the selected workspace. Server databases, logs, and runtime data use the workspace project home instead of VS Code extension global storage.

The extension does not bundle or install One Works runtime packages. It searches the selected workspace `node_modules/.bin` and then the system `PATH` for `oneworks` / `ow` / `owo`, then runs the `web` subcommand.

Install the bootstrap launcher in the project that you want to control:

```bash
pnpm add -D oneworks
```

## Settings

- `oneworks.bootstrapCommand`: optional `oneworks` executable, command name, or wrapper command.

## Boundary

The extension does not duplicate client or server business logic. It only owns workspace selection, server process lifecycle, and the right sidebar webview wrapper.

## Release

Package a local VSIX:

```bash
pnpm -C apps/vscode-extension package
```

Publish from an existing VSIX to VS Code Marketplace:

```bash
VSCODE_EXTENSION_PUBLISHER=your-publisher-id VSCE_PAT=your-token \
pnpm -C apps/vscode-extension publish:vsix -- --packagePath ./oneworks-vscode-extension-v0.1.0.vsix
```

Publish the same VSIX to Open VSX Registry for VS Code-compatible IDEs:

```bash
OVSX_PAT=your-token \
pnpm dlx ovsx@1.0.1 publish --skip-duplicate ./oneworks-vscode-extension-v0.1.0.vsix -p "$OVSX_PAT"
```

Open VSX requires a namespace that matches the extension publisher, such as `oneworks-ai`.

CI builds and uploads a VSIX artifact on VS Code extension changes. Tags that match `pkg/oneworks-vscode-extension/v*` package the same VSIX, optionally publish it to VS Code Marketplace when `VSCODE_EXTENSION_PUBLISHER` and `VSCE_PAT` are configured, optionally publish it to Open VSX when `OVSX_PAT` is configured, and attach it to a GitHub Release.
