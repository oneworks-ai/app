# Asset Directories and Adapter Compatibility

Unified One Works plugins can contribute data assets and can also bridge adapter-native assets when a plugin format provides reusable rules, skills, MCP servers, hooks, specs, or entities.

## Asset Directories

A plugin package can expose conventional directories such as:

- `rules`
- `skills`
- `specs`
- `entities`
- `mcp`
- `hooks`

The plugin manifest determines which assets are loaded and how they are scoped. When a plugin instance has a `scope`, loaded asset IDs are prefixed with that scope.

## Paths Inside Plugin Assets

Strings inside plugin assets can use `${ONEWORKS_PLUGIN_ROOT}` for the resolved absolute plugin root and
`${ONEWORKS_NODE_EXECUTABLE}` for OneWorks' reliable current Node runtime. MCP assets should use these
variables for packaged Node server entry points instead of depending on the session working directory,
the user's `PATH`, or the workspace's `node_modules/.bin`:

```json
{
  "command": "${ONEWORKS_NODE_EXECUTABLE}",
  "args": ["${ONEWORKS_PLUGIN_ROOT}/bin/server.cjs"]
}
```

MCP assets may also explicitly use `${ONEWORKS_REAL_HOME}`. Reserve it for local integrations that
must share the real HOME with a user-level daemon, Unix socket, or native permission responsibility
chain; ordinary MCP servers should keep OneWorks' isolated HOME. When required, override both `HOME`
and `USERPROFILE` so the server and daemon resolve the same location:

```json
{
  "env": {
    "HOME": "${ONEWORKS_REAL_HOME}",
    "USERPROFILE": "${ONEWORKS_REAL_HOME}"
  }
}
```

To pass an instance option into a plugin asset, opt in to that exact value with
`${ONEWORKS_PLUGIN_OPTION:path.to.value}`. Primitive values become strings; missing values become an
empty string. This keeps plugin options out of the process environment unless the asset explicitly
declares the value it needs:

```json
{
  "env": {
    "POINTER_COLOR": "${ONEWORKS_PLUGIN_OPTION:pointer.color}"
  }
}
```

## Local Project Assets

Project assets in `.oo/` still have priority in the places where project ownership should win. If a plugin asset and a local asset use the same name, add a plugin scope and reference the scoped ID explicitly.

## Adapter Compatibility

Adapter-native plugins may have a different directory layout and different runtime placeholders. One Works converts reusable assets into a `oneworks/` directory when possible. Converted assets keep runtime placeholders such as `${CLAUDE_PLUGIN_*}` so they resolve inside the current workspace at runtime instead of writing absolute home paths into the project snapshot.

Adapter-native managed installs live under the project home:

```text
<project-home>/.local/plugins/<adapter>/<slug>/
```

That location is private runtime data and should not be committed.

## When to Declare a Runtime Plugin

Converted assets do not automatically become unified runtime plugins. If you want One Works to load the converted `oneworks/` directory as a plugin, declare it explicitly in the top-level `plugins` config.

This keeps adapter-native installation and One Works runtime plugin loading separate and predictable.
