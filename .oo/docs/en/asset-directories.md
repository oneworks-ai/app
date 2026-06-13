# Data Asset Directories

This page explains how to move One Works project data assets with `.env` variables and which runtime data is stored in the project-scoped home directory.

## Default Layout

By default, the project data asset root is `./.oo/`. Common directories are:

- `./.oo/rules`
- `./.oo/skills`
- `./.oo/specs`
- `./.oo/entities`
- `./.oo/mcp`

If a project does not have a clearer engineering location such as `packages/plugins`, ordinary local plugins can be placed under `./.oo/plugins/<name>`. That is only a suggested location. The host does not scan it automatically; the plugin must still be declared in `.oo.config.json`.

Runtime data is not written into the workspace by default. It is stored under:

```text
~/.oneworks/projects/<project-key>/
```

Common runtime directories include `logs`, `caches`, `.mock`, `.local`, and `runtime`. Adapter-native managed plugin install snapshots are private runtime data and are stored under `.local/plugins/<adapter>/<slug>/install`; plugin runtime data is stored under `.local/plugins/<adapter>/<slug>/data`.

## Skill Dependencies

See [Skills and Dependencies](./usage/skills.md) for the complete skill flow.

`./.oo/skills/<name>/SKILL.md` frontmatter can declare dependencies:

```yaml
---
name: app-builder
description: Build the app
dependencies:
  - frontend-design
  - anthropics/skills@frontend-design
---
```

Resolution rules:

- Resolve by name from the current workspace and enabled plugin skills first.
- Remote dependencies referenced by plugin skills are resolved from `.oo/skills/.plugins`.
- One Works also bridges common real home skill roots by default: `~/.agents/skills`, `~/.claude/skills`, `~/.config/opencode/skills`, and `~/.gemini/skills`.
- Home skills enter the unified workspace asset graph and can be selected like project skills.
- Project skills, plugin skills, and installed dependencies take priority over same-name home skills.
- Missing local dependencies fail at runtime; they are not downloaded automatically.
- Project maintainers can run `oneworks skills install` or `oneworks skills update` to materialize project declarations and metadata dependencies into `.oo/skills` and `.oo/skills.lock.yaml`.

To pin a dependency source, put the registry directly in the skill spec:

```yaml
skills:
  - https://registry.example.com@example-source/default/public@design-review@1.0.3
```

Adapter startup projects the final resolved skill list into the native adapter directories.

To disable the home bridge:

```yaml
skills:
  homeBridge:
    enabled: false
```

To override bridge roots:

```yaml
skills:
  homeBridge:
    roots:
      - ~/.agents/skills
      - /opt/team-skills
```

`roots` supports absolute paths and paths starting with `~`. Missing directories are skipped.

Project-managed remote skills can be declared in `.oo.config.*`:

```yaml
skills:
  - frontend-design
  - name: design-review
    source: example-source/default/public
    rename: internal-review
```

These skills are installed into `./.oo/skills/` by maintainer commands. Ordinary `oneworks` and server sessions do not download or update them unless `oneworks --update-skills` or API `updateSkills: true` is used. `rename` controls both the local directory name and the local `SKILL.md` `name`.

## Environment Variables

Project root `.env` can override asset directories:

```dotenv
__ONEWORKS_PROJECT_BASE_DIR__=.oneworks
__ONEWORKS_PROJECT_ENTITIES_DIR__=agents
```

Meaning:

- `__ONEWORKS_PROJECT_BASE_DIR__` overrides the whole project data asset root.
- `__ONEWORKS_PROJECT_ENTITIES_DIR__` overrides only the entities subdirectory, resolved under the AI base directory.

Both variables support paths relative to the project root, nested relative paths, and absolute paths.

Example:

```dotenv
__ONEWORKS_PROJECT_BASE_DIR__=.oo
__ONEWORKS_PROJECT_ENTITIES_DIR__=knowledge/entities
```

This resolves the AI base directory to `./.oo` and the entities directory to `./.oo/knowledge/entities`.

## What Changes

These variables affect the main project asset consumers:

- workspace assets: `rules`, `skills`, `specs`, `entities`, `mcp`
- project asset directories: `rules`, `skills`, `specs`, `entities`, `mcp`, `plugins`
- project-scoped runtime directories: `logs`, `caches`, `.mock`, `.local`, `runtime`
- mock HOME and derived adapter directories for Codex, Claude Code, and OpenCode
- CLI maintenance commands such as `oneworks clear` and `oneworks report`
- CLI, server, client, hook loader, desktop, and VS Code extension startup
- benchmark runtime directories

`<project-home>/.local` is for private local project data and should not be committed.

When `DB_PATH` is not set, the server stores the SQLite session database at:

```text
~/.oneworks/projects/<project-key>/.local/server/db.sqlite
```

This lets multiple worktrees of the same Git project share sessions and Agent Room state without writing the database into the workspace. Adapter account snapshots, authentication digests, quota metadata, and other local-only authentication state also live under the project home.

## What Does Not Change

These variables do not move configuration files:

- `.oo.config.json` / `.oo.config.yaml` / `.oo.config.yml`
- `.oo.dev.config.*`
- `~/.oneworks/.oo.config.json`
- default workspace configuration under the resolved workspace root or `./infra/`

Use `__ONEWORKS_PROJECT_CONFIG_DIR__` if you need to move configuration files. `__ONEWORKS_PROJECT_BASE_DIR__` and `__ONEWORKS_PROJECT_ENTITIES_DIR__` configure data assets, not config file names or locations.

## Recommendations

- If you only want to rename `.oo`, set `__ONEWORKS_PROJECT_BASE_DIR__`.
- If you only want to rename `entities`, set `__ONEWORKS_PROJECT_ENTITIES_DIR__`.
- If both are set, the entities directory is resolved under the new AI base directory.
- Restart the affected processes after changing `.env`; refreshing the browser does not reload directories in already-running child processes.
