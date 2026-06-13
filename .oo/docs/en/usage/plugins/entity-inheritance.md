# Entity Inheritance

Entities can inherit plugin-provided or project-provided behavior. Inheritance lets a project reuse a base agent, spec, prompt, or rule set while keeping local overrides small.

## Principles

- Plugin entities should be treated as reusable bases.
- Project entities own final behavior for the project.
- Scoped resources avoid name collisions between multiple plugins.
- Local overrides should be explicit so it is clear which project file changed behavior.

When a plugin provides an entity base, the project can reference it by scoped ID and override only the fields that differ.
