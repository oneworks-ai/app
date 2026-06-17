# Project-managed Skills

Project-managed skills let a repository declare a stable set of remote skills that maintainers install into the project asset directory.

## Configuration

```yaml
skills:
  - frontend-design
  - name: design-review
    source: example-source/default/public
    rename: internal-review
```

Behavior:

- `oneworks skills install` installs missing declared skills.
- `oneworks skills update` refreshes installed declared skills.
- Ordinary `oneworks` and server sessions do not download or update skills by default.
- `oneworks --update-skills` or API `updateSkills: true` forces a refresh at startup.
- `rename` controls the local directory name and the local `SKILL.md` name.

## Lockfile

Installed skills should be reflected in:

```text
.oo/skills.lock.yaml
```

The lockfile makes project skill inputs reviewable and repeatable.

## CLI Built-in Skills

`@oneworks/cli` includes companion skills from `@oneworks/plugin-cli-skills`:

- `oneworks-cli-quickstart`
- `oneworks-cli-print-mode`
- `oneworks-model-services`
- `create-entity`
- `update-entity`
- `create-plugin`

Use them explicitly with `--include-skill` when you want those workflows to guide a CLI task.
