# One Works 0.1.0-beta.9

- Give One Works official marketplace plugins their real icons and stable categories, prioritize featured first-party plugins, and keep OpenAI and other external recommendations visible.
- Keep the Account entry and other built-in plugin interface contributions available after Electron app updates, with Launcher starting and using its own local Manager runtime instead of falling back to a stale development server.
- Keep the Launcher window empty while its local runtimes are starting, including longer first-run Manager cache preparation, instead of showing a branded placeholder, fake progress bar, or unrelated project picker.
- Cut packaged Launcher warm startup time by trusting immutable build manifests, preparing built-in runtime caches only once across the loader handoff, and deferring background refresh until the first local runtime is ready.
- Make packaged official plugins load reliably across the launcher's and workspace server's loopback origins, including shared dependencies and projects with older local copies.
