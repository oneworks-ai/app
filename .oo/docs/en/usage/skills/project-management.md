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

## Skill Market Sources

The Skill Market includes the official Vercel, Anthropic, and Microsoft skill collections by default,
so no registry setup is required before browsing. Content is downloaded into `.oo/skills` only
after you click a specific skill's install action. Each skill has **Install to project** and
**Install globally** actions, which write the declaration to `.oo.config.json` or
`~/.oneworks/.oo.config.json`, respectively. A registry's owning config layer controls its search
source and metadata, but does not restrict the install target. Calls that omit the target retain the
legacy behavior and write to the registry's owning layer. Custom registries are managed on the separate **Skills > Registry Settings**
page and are stored in the selected config layer's `skillRegistries` field. Legacy
`skillsMeta.sources` entries remain visible and removable there. OneWorks
bundled/plugin skills appear directly under **Project Skills**; OneWorks does not currently operate
a separate public registry.

The import action appears on the right side of the **Project / Global** scope tabs. In **Project**, an
archive is extracted into the current workspace's `.oo/skills`. In **Global**, it is extracted into the
real Home's `~/.agents/skills` and appears in the global scope through the default home bridge.
The archive must contain one top-level directory per skill, with a `SKILL.md` in each directory. Import
rejects oversized or unsafe archives and refuses to overwrite an existing skill unless an API client
explicitly retries with force; forced multi-skill replacements are rolled back together on failure.
Concurrent imports targeting the same physical skills directory receive HTTP 409 while another import is in progress.

**Skills > Registry Settings** lists both the built-in official sources and custom registries. Built-in
sources cannot be deleted; their switch writes `skillRegistries[].enabled` in the effective config layer.
When set to `false`, the Store no longer searches or installs from that source.

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
