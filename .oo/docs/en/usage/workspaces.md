# Workspace Scheduling

## Configuration

Large repositories can declare schedulable workspaces in root `.oo.config.json`. A workspace does not need to be a Git submodule; it can be an ordinary directory or a symlink to a directory.

Minimal configuration:

```json
{
  "workspaces": {
    "include": ["services/*", "apps/*"],
    "exclude": ["services/legacy"]
  }
}
```

Stable IDs and descriptions:

```json
{
  "workspaces": {
    "include": ["services/*"],
    "entries": {
      "docs": {
        "path": "documentation",
        "description": "Product and integration docs"
      }
    }
  }
}
```

## Runtime Semantics

- When `oneworks` starts at the repository root, One Works lists declared workspaces in the system prompt.
- When a task belongs to a workspace, the agent should start a child runtime session with `oneworks agent start` or the runtime protocol, including the workspace ID and path in the title or initial message.
- The child task uses the target workspace directory as `cwd` and reloads that workspace's `.oo.config.*`, `.oo/` data assets, MCP servers, hooks, and adapter configuration.
- The current session does not need to directly modify code inside a registered workspace; the child task owns those changes.

## CLI

Specify a workspace from the command line:

```bash
oneworks --workspace billing "fix the order status rollback issue"
```

`--workspace` is mutually exclusive with `--spec` and `--entity`. Workspace IDs come from `entries` keys. Directories discovered by glob use the directory name by default; relative paths are used when names collide.
