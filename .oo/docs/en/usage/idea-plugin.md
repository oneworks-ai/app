# JetBrains IDE Plugin

The JetBrains IDE plugin lives in `apps/idea-plugin` and is currently a thin shell:

- Registers a `One Works` tool window in the IDE.
- Starts a local One Works Web runtime for the current IDE project when the tool window opens.
- Loads the project server `/ui/` route through a JCEF webview.
- Uses the current IDE project root as the One Works workspace.
- Stores server data and logs under the IDE system directory at `oneworks/idea-plugin/<workspace-hash>/`, so runtime data does not get written into the project repository.

## Prepare a Project

Install the bootstrap launcher in the project you want to control, or make it available on `PATH`:

```bash
pnpm add -D oneworks
```

The plugin first searches the project `node_modules/.bin`, then the system `PATH`, for `oneworks` / `ow` / `owo` and runs the `web` subcommand. If no local launcher is found, it falls back to `npx -y oneworks web`.

## Runtime Model

The default startup command is equivalent to:

```bash
oneworks web \
  --host 127.0.0.1 \
  --port <free-port> \
  --base /ui \
  --workspace <IDE project root> \
  --data-dir <IDE system dir>/oneworks/idea-plugin/<workspace-hash>/data \
  --log-dir <IDE system dir>/oneworks/idea-plugin/<workspace-hash>/logs
```

The plugin also injects these key environment variables:

```bash
__ONEWORKS_PROJECT_WORKSPACE_FOLDER__=<IDE project root>
__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__=<IDE project root>
__ONEWORKS_PROJECT_CLIENT_BASE__=/ui
__ONEWORKS_PROJECT_CLIENT_MODE__=static
__ONEWORKS_PROJECT_SERVER_HOST__=127.0.0.1
__ONEWORKS_PROJECT_SERVER_PORT__=<free local port>
__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__=false
```

Each IDE project gets an independent local server, port, data directory, and log directory. The plugin dynamically allocates the port and retries with a new port if startup loses a port race.

## Supported IDEs and Versions

The plugin declares `since-build="243"` and depends only on `com.intellij.modules.platform`. It targets JetBrains IDEs based on IntelliJ Platform 2024.3 or newer, not only IntelliJ IDEA; WebStorm 2024.3+ is an intended compatibility target.

Current CI builds and verifies against IntelliJ IDEA 2024.3.6. Other JetBrains IDE products do not yet have product-specific verifier jobs. If an IDE runtime does not provide JCEF, the plugin shows an external browser fallback in the tool window.

## Development Overrides

To start a local checkout or wrapper, set this before launching the IDE:

```bash
export ONEWORKS_IDEA_BOOTSTRAP_COMMAND="pnpm exec oneworks"
```

The command runs from the current IDE project root. The plugin appends `web` and the required arguments automatically.

To fully replace the startup command, set:

```bash
export ONEWORKS_IDEA_SERVER_COMMAND="npx oneworks web"
```

A full override must ensure the server listens on the injected port, or it must pass compatible `oneworks web --host / --port / --base / --workspace` arguments itself.

## Build

```bash
cd apps/idea-plugin
gradle runIde
gradle buildPlugin
gradle verifyPluginStructure
```

Local builds use IntelliJ IDEA 2024.3.x as the Gradle target platform. Gradle 9.0+ is required. The project configures the Foojay toolchain resolver and Java 21 toolchain so Gradle can provision Java 21 when it is not installed locally.
