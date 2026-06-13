# Skill Resolution

Skill resolution combines project skills, plugin skills, installed dependencies, and optionally bridged home skills into one workspace asset graph.

## Resolution Order

When a skill name is requested:

1. Resolve from current project skills.
2. Resolve from enabled plugin skills.
3. Resolve from installed dependency skills.
4. Resolve from bridged home skill roots.

Project-owned and plugin-owned skills take priority over same-name home skills.

## Dependencies

`SKILL.md` can declare dependencies in frontmatter:

```yaml
---
name: app-builder
dependencies:
  - frontend-design
  - anthropics/skills@frontend-design
---
```

Dependencies are resolved before the task starts. Runtime does not silently download missing dependencies. Project maintainers should materialize remote skills with `oneworks skills install` or `oneworks skills update`.

## Remote Specs

A dependency can pin a registry source:

```yaml
skills:
  - https://registry.example.com@example-source/default/public@design-review@1.0.3
```

The installed result belongs in project skill directories and should be represented in `.oo/skills.lock.yaml`.

## Adapter Projection

After resolution, the final skill list is projected into the native adapter directories. This lets adapters such as Codex, Claude Code, OpenCode, or Gemini see skills in their expected native format while keeping One Works's project asset graph as the source of truth.
