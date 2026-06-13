# Entity Default Files

Plugins can provide default files for entity scaffolding. These files are copied when an entity is created and give teams a consistent starting point for prompts, rules, specs, or other project-owned assets.

## Behavior

- Defaults come from the active plugin graph.
- Project assets can override or extend plugin-provided defaults.
- Scoped plugin resources should be referenced with their scoped ID to avoid ambiguity.
- Defaults are used at creation time; later edits belong to the project.

Use entity defaults when a plugin wants to provide a reusable project convention without taking ownership of the resulting project files.
