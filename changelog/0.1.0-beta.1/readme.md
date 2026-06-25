# One Works 0.1.0-beta.1

- Resolve runtime packages from the same prerelease series as the bootstrap package, so `oneworks@beta` installs beta runtime modules instead of falling back to `latest` alpha modules.
- Split model adapter preference from compatibility filtering. `defaultAdapter` remains a legacy preference, while `supportedAdapters` and `unsupportedAdapters` now explicitly control service/model adapter compatibility.
- Keep native adapter defaults such as Codex `default` ahead of `defaultModelService` when no explicit model is configured, so logged-in Codex accounts can use their account default model without selecting a concrete model.
