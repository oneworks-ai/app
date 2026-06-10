# Task Board Demo

Scenario: a single-project task-board workspace for showing One Works against realistic user code. It includes project rules, startup presets, run commands, and a small JavaScript module with tests.

## Try It

```bash
pnpm test
npx oneworks web
npx oneworks Read this workspace and suggest one small improvement
```

For the desktop app:

```bash
npx oneworks app
```

## What To Show

- The new-session presets from `.oo.config.json`.
- The project rule in `.oo/rules/PROJECT.md`.
- Workspace file links to `src/task-board.mjs` and `test/task-board.test.mjs`.
- Header run commands for `pnpm test` and `pnpm start`.

Runtime files stay under the home project directory (`~/.oneworks/projects/<project-key>`) instead of this demo workspace.
