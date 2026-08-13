# DeepSeek Harness (DSH) Adapter

The `dsh` adapter runs live text turns over the official DeepSeek Harness ACP example. One Works manages `@deepseek-ai/dsh-acp-demo@0.1.0-rc.6` together with the matching official DeepSeek model, sandbox, approval, filesystem, shell, token-meter, compaction, and todo plugins.

Set the API key in the One Works process environment, then select **DSH** and one of its native models:

```bash
export DEEPSEEK_API_KEY=...
```

```yaml
adapters:
  dsh:
    cli:
      source: managed
      version: 0.1.0-rc.6
    # Required acknowledgement: rc.6 confines writes, not host reads or network access.
    allowUnrestrictedReadNetwork: true
    # Optional DeepSeek-compatible endpoint override.
    baseUrl: https://api.deepseek.com
```

The adapter exposes `deepseek-v4-flash` and `deepseek-v4-pro`, the model IDs in the verified DSH ACP example. Generic One Works Model Services are not projected into DSH; provider routing remains owned by the official DeepSeek plugin composition.

Runtime and security boundaries:

- Each process receives isolated `HOME`, `DSH_HOME`, and `DSH_AGENTS_HOME` directories under the project-private session cache. The real DSH home is not modified.
- This initial integration supports macOS and Linux. Windows is rejected before installation because the official npm command-shim launch path has not yet been verified end to end.
- `DEEPSEEK_API_KEY` and optional `DEEPSEEK_BASE_URL` are passed only to the DSH child environment. They are not written into the generated Cordis composition or emitted in adapter events.
- DSH rc.6 sandbox modes constrain file modifications, but they do **not** confine host file reads, process visibility, or network access. The adapter therefore fails closed unless `allowUnrestrictedReadNetwork: true` explicitly acknowledges this upstream boundary. Treat DSH as trusted local code with network access; One Works permission prompts cover requested mutations, not every read or connection.
- The verified ACP contract supports fresh text sessions, live prompt turns, cancellation, streamed assistant text, and permission requests. DSH does not currently send title, tool-audit, or token-usage events over ACP. Resume/load, image/audio prompts, direct one-shot mode, MCP injection, and native disk-history import are not claimed. After the live runtime expires, start a new DSH session.
- Selected rules, specs, entities, and skills are mapped into the generated system prompt. Selected MCP servers are reported as skipped because the current DSH ACP example rejects non-empty MCP input.

Run `oneworks adapter prepare dsh` to download and validate the pinned official composition before the first session. See [Adapter CLI Installation and Versions](./adapter-cli.md) for source and path overrides. Managed mode deliberately fixes both the verified official package and version; use `system` or `path` only when you own and validate a custom compatible binary.

Upstream project: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
