# Examples

These fixtures are small standalone workspaces for demos, documentation screenshots, and local debugging. They are intentionally not part of the root `pnpm-workspace.yaml`, so they behave like external user projects instead of repository packages.

## Scenario Directories

Each child directory is one specific scenario. Some scenarios are intentionally small, while others can grow into richer multi-step fixtures.

- [task-board-demo](./task-board-demo/README.md): a single-project task-board demo with One Works presets, run commands, and project rules. Use it when showing One Works to users.
- [source-debug-fixture](./source-debug-fixture/README.md): a stable local source debugging fixture for file-link checks, config loading, run commands, and startup diagnostics.

## Run With Published Packages

```bash
cd examples/task-board-demo
npx oneworks app
npx oneworks web
npx oneworks Read the workspace and suggest one small improvement
```

Swap `task-board-demo` for `source-debug-fixture` when you need a narrower debugging scenario.

## Test A Scenario

Run scenario tests from the scenario directory itself:

```bash
cd examples/task-board-demo
pnpm test

cd ../source-debug-fixture
node scripts/smoke.mjs
```

When developing One Works itself, keep repository-level commands such as `pnpm --silent tools dev-service ensure web --json`, `pnpm typecheck`, and root tooling at the repository root unless the task is specifically about an example scenario.

## Run Against Local Source

From the repository root:

```bash
EXAMPLE="$PWD/examples/task-board-demo"

__ONEWORKS_PROJECT_WORKSPACE_FOLDER__="$EXAMPLE" \
__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__="$EXAMPLE" \
__ONEWORKS_PROJECT_LAUNCH_CWD__="$EXAMPLE" \
pnpm --silent tools dev-service ensure web --json
```

This starts the local One Works source server/client while treating the selected example as the active user workspace.

## Cleanup

```bash
rm -rf examples/*/.logs
rm -rf ~/.oneworks/projects/*task-board-demo* ~/.oneworks/projects/*source-debug-fixture*
```
