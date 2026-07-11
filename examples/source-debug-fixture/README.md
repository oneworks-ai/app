# Source Debug Fixture

Scenario: a stable external-looking workspace for debugging One Works source builds. It keeps the project small so config loading, file links, startup presets, run commands, and runtime storage behavior are easy to inspect.

## Run Against Published Packages

```bash
npx oneworks web
npx oneworks Read fixtures/notes.md and summarize the source debug fixture
```

## Run Against Local Source

From the repository root:

```bash
EXAMPLE="$PWD/examples/source-debug-fixture"

__ONEWORKS_PROJECT_WORKSPACE_FOLDER__="$EXAMPLE" \
__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__="$EXAMPLE" \
__ONEWORKS_PROJECT_LAUNCH_CWD__="$EXAMPLE" \
pnpm --silent tools dev-service ensure web --json
```

The `Smoke fixture` run command executes `node scripts/smoke.mjs` and prints a small JSON payload for quick sanity checks. Runtime files stay under the home project directory (`~/.oneworks/projects/<project-key>`) instead of this fixture workspace.
