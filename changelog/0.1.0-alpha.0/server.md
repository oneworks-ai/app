# Server 0.1.0-alpha.0

- Dispatch channel webhooks for both GET verification requests and POST event callbacks, and pass raw request bodies through to channel packages for platform signature checks.
- Isolate dev-start workspace state per source worktree and serialize parallel port selection to reduce local launcher conflicts.
- Reuse workspace servers across client-only dev changes and show actionable version-conflict diagnostics with a restart path.
- Ensure launcher workspace instance lock directories are created before acquiring per-workspace locks.
- Prevent duplicate workspace server startups for the same workspace by recording live launcher instances, reusing matching versions, and returning a conflict for mismatched versions or launch config.
- Return Coding Plan and Token Plan provider metadata from the model provider registry so clients can use static model catalogs without calling provider model-list APIs.
- Normalize Kimi Code `/coding/v1/usages` responses into model service quota status.
- Add New API compatible management actions for model service collections, including account snapshots, token listing, token creation, token updates, deletion, and generated token-backed model service profiles.
