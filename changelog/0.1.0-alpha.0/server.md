# Server 0.1.0-alpha.0

- Dispatch channel webhooks for both GET verification requests and POST event callbacks, and pass raw request bodies through to channel packages for platform signature checks.
- Isolate dev-start workspace state per source worktree and serialize parallel port selection to reduce local launcher conflicts.
- Ensure launcher workspace instance lock directories are created before acquiring per-workspace locks.
- Prevent duplicate workspace server startups for the same workspace by recording live launcher instances, reusing matching versions, and returning a conflict for mismatched versions or launch config.
