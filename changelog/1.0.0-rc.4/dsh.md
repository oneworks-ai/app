# DeepSeek Harness (DSH)

- Add a built-in DSH adapter backed by the official `@deepseek-ai/dsh-acp-demo@0.1.0-rc.6` ACP process and matching official plugin composition.
- Add managed installation, native DeepSeek V4 Flash/Pro selection, isolated session homes, streamed text projection, and request-scoped permission handling.
- Keep unsupported resume, media, MCP injection, direct mode, and native history boundaries explicit.
- Require explicit acknowledgement that the upstream rc.6 sandbox constrains writes but does not isolate host reads, process visibility, or network access.
- Limit the initial verified platform surface to macOS and Linux; Windows fails closed before managed installation.
