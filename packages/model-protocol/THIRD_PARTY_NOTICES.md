# Third-party design reference

The converter topology and fixture scenarios were independently reimplemented
after studying CLIProxyAPI at commit
`f43aad7637ad813745bf7d341acb5663617570c5` (MIT License), especially its
translator registry and OpenAI Responses conversion test cases. No source files
or SDK code are vendored by this package.

The portable reference boundary is limited to protocol topology, request-local
translation state machines, first-complete-frame commit fences, account
selection concepts, and test scenarios. One Works does not reuse CLIProxyAPI's
private `chatgpt.com/backend-api/codex` executor, hard-coded `codex-tui`
user-agent or Originator identity, `Chatgpt-Account-Id` transport, or OAuth
client identity/token exchange. Codex account execution in One Works goes only
through the installed official Codex CLI and `codex app-server`.
