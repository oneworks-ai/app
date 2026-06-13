# Skills and Dependencies

Skills are reusable instructions and workflows that can be selected by the runtime or included explicitly for a task.

## Where Skills Live

Project skills usually live under:

```text
./.oo/skills/<name>/SKILL.md
```

Plugin skills come from enabled plugin packages. Home skills can be bridged from common user directories such as:

- `~/.agents/skills`
- `~/.claude/skills`
- `~/.config/opencode/skills`
- `~/.gemini/skills`

Home bridge can be disabled:

```yaml
skills:
  homeBridge:
    enabled: false
```

Or pointed at explicit roots:

```yaml
skills:
  homeBridge:
    roots:
      - ~/.agents/skills
      - /opt/team-skills
```

## Skill Metadata

`SKILL.md` frontmatter includes name, description, and optional dependencies:

```yaml
---
name: app-builder
description: Build the app
dependencies:
  - frontend-design
  - anthropics/skills@frontend-design
---
```

Resolution order:

- current workspace skills
- enabled plugin skills
- installed dependency skills
- bridged home skills

Project and plugin skills win over same-name home skills. Missing dependencies fail at runtime and are not downloaded automatically.

## Project-managed Skills

Project config can declare skills that maintainers install into the project:

```yaml
skills:
  - frontend-design
  - name: design-review
    source: example-source/default/public
    rename: internal-review
```

Maintainer commands:

```bash
oneworks skills install
oneworks skills update
```

Ordinary `oneworks` and server sessions do not download or update project-managed skills unless explicitly requested with `oneworks --update-skills` or API `updateSkills: true`.

## Include a Skill

CLI:

```bash
oneworks --include-skill oneworks-cli-quickstart "explain oneworks CLI resume behavior"
```

The runtime may also select skills based on the task and available metadata.

## Dependency Details

See:

- [Skill Resolution](./skills/resolution.md)
- [Project-managed Skills](./skills/project-management.md)
- [Home Bridge](./skills/home-bridge.md)
