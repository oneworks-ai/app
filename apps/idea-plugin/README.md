# One Works JetBrains IDE Plugin

en-US | [zh-Hans](./README.zh-Hans.md)

This package is a thin IntelliJ Platform shell for the existing One Works Web UI.

## Behavior

- Adds a `One Works` tool window.
- Starts one One Works Web runtime per opened IDE project.
- Loads the One Works client from the project-local server in a JCEF webview.
- Uses an IDE-system runtime directory for server data and logs, keyed by the IDE project path hash.

The plugin does not bundle One Works runtime packages. It first searches the selected project `node_modules/.bin` and then the system `PATH` for `oneworks` / `ow` / `owo`, and runs the `web` subcommand. If no bootstrap launcher is found, it falls back to:

```bash
npx -y oneworks web --host 127.0.0.1 --port <free-port> --base /ui --workspace <project-root> --data-dir <ide-system-dir> --log-dir <ide-system-dir>
```

Install the bootstrap launcher in the project that you want to control:

```bash
pnpm add -D oneworks
```

## Compatibility

The plugin declares `since-build="243"` and depends only on `com.intellij.modules.platform`, so it targets JetBrains IDEs based on IntelliJ Platform 2024.3 or newer, including IntelliJ IDEA and WebStorm.

Current CI builds and verifies the plugin against IntelliJ IDEA 2024.3.6. Other JetBrains IDE products are intended compatibility targets, but they are not yet covered by product-specific verifier jobs. If the IDE runtime does not provide JCEF, the tool window shows an external browser fallback.

## Development Overrides

- `ONEWORKS_IDEA_BOOTSTRAP_COMMAND`: optional `oneworks` executable, command name, or wrapper command. The plugin appends `web` and the required host, port, base, workspace, data, and log arguments.
- `ONEWORKS_IDEA_SERVER_COMMAND`: full shell command override for local development. Use this only when the command itself reads the injected `__ONEWORKS_PROJECT_*` environment variables or supplies compatible `oneworks web` arguments.

## Boundary

The plugin only owns IDE integration, workspace selection from the current project, server process lifecycle, and the JCEF wrapper. Client, server, adapter, plugin, and runtime behavior comes from the normal One Works runtime.

## Development

This project uses the IntelliJ Platform Gradle Plugin 2.x.

```bash
cd apps/idea-plugin
gradle runIde
gradle buildPlugin
gradle verifyPluginStructure
```

Gradle 9.0+ is required. The build configures Foojay toolchain resolution so Gradle can provision Java 21 when it is not installed locally.
