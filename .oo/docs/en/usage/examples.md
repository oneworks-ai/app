# Examples Directory

The repository root provides [examples/](https://github.com/oneworks-ai/app/tree/main/examples) for user demos and local debugging. Each subdirectory represents a clear scenario. Examples are intentionally kept out of the root `pnpm-workspace.yaml` so they behave like external user projects and do not affect package release, type builds, or test discovery in the main repository.

## Current Examples

- [task-board-demo](https://github.com/oneworks-ai/app/tree/main/examples/task-board-demo): a single-project task board demo with `.oo.config.json`, project rules, startup presets, and run commands.
- [source-debug-fixture](https://github.com/oneworks-ai/app/tree/main/examples/source-debug-fixture): a stable source debugging fixture for configuration loading, file links, startup presets, run commands, and runtime data isolation.

## Start with Published Packages

```bash
cd examples/task-board-demo
npx oneworks app
npx oneworks web
npx oneworks "Read the workspace and suggest one small improvement"
```

## Test Example Scenarios

Run commands from the corresponding example directory:

```bash
cd examples/task-board-demo
pnpm test

cd ../source-debug-fixture
node scripts/smoke.mjs
```

When developing the One Works repository itself, keep running repository-level commands such as `pnpm --silent tools dev-service ensure web --json` and `pnpm typecheck` from the repository root. Switch into an example directory only when testing that example as a user project.

## Use Local Source

If you are developing One Works locally and want an example to use the current source checkout, run repository-level development commands from the main repository and point the runtime at the example workspace. This keeps the example independent while letting the local source provide server, client, adapter, and CLI code.
