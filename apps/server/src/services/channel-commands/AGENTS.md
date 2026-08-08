# Channel Command Authority

This directory owns capability tokens used when a running channel ChildSession invokes sender-scoped typed commands.

- `invocation-token.ts`: creates and verifies short-lived HMAC tokens bound to `channelKey`, `childRunId`, and `sessionId`.

The CLI is an untrusted transport. Routes must not authorize from caller-provided actor, session, working directory, or reply-target fields. Verify the token, load the persisted child run, session actor snapshot, and immutable delivery binding, cross-check their identities, and rebuild command context on the server.

Tokens are process-local and intentionally become invalid after a server restart. Never persist the signing key in a workspace or expose it through normalized session snapshots, logs, or command output. The raw token may exist only in the protected per-message channel context file consumed by the child process.
