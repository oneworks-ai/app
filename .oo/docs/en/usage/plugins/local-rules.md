# Local Rules

Plugins can contribute reusable rules, but project local rules remain the final place for project-specific guidance.

Use local rules when:

- the rule describes repository-specific architecture or maintenance behavior
- the rule should be edited by project maintainers
- the rule depends on local paths, scripts, or deployment assumptions

Use plugin rules when:

- the rule is reusable across projects
- the rule describes plugin-provided behavior
- the rule should version with the plugin package

If a plugin and project both provide similar guidance, keep the project rule explicit and scoped to local reality.
