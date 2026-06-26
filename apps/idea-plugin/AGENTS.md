# One Works JetBrains IDE Plugin

This package owns the IntelliJ Platform shell for One Works.

## Scope

- Register the `One Works` tool window and Tools menu action.
- Start one project-local One Works Web runtime per opened IDE project.
- Embed the runtime client through JCEF.
- Keep IDE plugin lifecycle, local server process management, and user-facing plugin metadata here.

The plugin must not duplicate client, server, adapter, or runtime business logic. Those remain in the existing One Works packages and are reached through the `oneworks web` bootstrap entry.

## Key Files

- `src/main/java/ai/oneworks/idea/OneWorksServerController.java`: resolves the bootstrap launcher, starts/stops the local server, checks readiness, and isolates data/log directories.
- `src/main/java/ai/oneworks/idea/OneWorksProjectService.java`: owns the tool window UI, JCEF browser, restart/open actions, and startup error states.
- `src/main/resources/META-INF/plugin.xml`: IntelliJ plugin id, display name, service, tool window, and action registration.

## Validation

Use Gradle from this package directory:

```bash
gradle buildPlugin verifyPluginStructure
```

Run repository formatting checks after doc or metadata edits:

```bash
pnpm exec dprint check apps/idea-plugin .oo/docs changelog
```
