# One Works 1.0.0-rc.0

- Create entities, flows, and rules directly from Data Assets with canonical slugs, collision checks, safe destination previews, and reconciliation before retry when completion is uncertain.
- Reuse one compatible Codex app-server across tasks and model providers while preserving per-thread configuration, approvals, lifecycle, hooks, and project isolation.
- Improve Codex account reauthentication, merged profile details, and quota views, including stale-credential protection, reset-credit visibility, and confirmation before use.
- Support adapter-level HTTP(S) proxy, `NO_PROXY`, and custom CA configuration for Codex traffic and routed model-service requests.
- Show explicit eligibility, deletion, and recovery states for session worktree actions across Git, workspace, and runtime limitations.
- Strengthen unsigned macOS desktop candidates with complete ad-hoc resource sealing and stricter arm64/x64 DMG, PKG, and ZIP verification.
- Restore all locale and theme variants of the adapter documentation videos with complete decode verification.
- Prevent Desktop and other standalone runtimes from inheriting host loader markers or Node preload state that could leave the packaged app on a white screen.

Compatibility notes: `POST /api/ai/assets` now returns HTTP 202 with an operation that clients poll to completion; worktree creation eligibility is enforced explicitly; and runtime packages must be rolled out on the coordinated `1.0.0-rc.0` identity for exact-version compatibility.
