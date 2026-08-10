# Pi coding-agent Adapter

The `pi` adapter uses Pi's JSONL RPC mode for persistent sessions. Its managed default is
`@earendil-works/pi-coding-agent@0.84.1`, which requires Node.js 22.19.0 or newer:

```yaml
adapters:
  pi:
    cli:
      source: managed
      version: 0.84.1
    telemetry: off
    disableVersionCheck: true

modelServices:
  team:
    apiBaseUrl: https://gateway.example.com/v1/responses
    apiKey: ${TEAM_API_KEY}
    models:
      - gpt-5.6-terra
    extra:
      pi:
        api: openai-responses
        input:
          - text
          - image
```

If the local Pi installation is already authenticated or has a provider configured, select `Pi`
in the sender and keep the model on `default`. One Works reuses Pi's default provider/model and
seeds its credentials into the project-private profile. Use `pi --version` to check the local
installation, or run `oneworks adapter prepare pi` to prepare the managed version ahead of time.
Neither path writes back to real Pi profile data or session files. When a real `auth.json` exists, One Works only briefly uses the upstream-compatible `auth.json.lock` to read a consistent snapshot.

Selecting `model: team,gpt-5.6-terra` creates a session-private Pi provider. API keys and
custom headers are passed through environment variables and are never written as plaintext to
`models.json`.

Runtime boundaries:

- One Works model services use a session-isolated `PI_CODING_AGENT_DIR`; native/default models use a durable project-private Pi profile. Existing `auth.json` credentials only seed that profile, so OAuth refreshes and Pi's concurrent credential lock remain private and durable. A real Pi login change or logout is synchronized, but One Works does not write back real profile data or session files; it only briefly creates the upstream-compatible `auth.json.lock` while reading an existing real auth file. Native Pi sessions in the same project intentionally share this profile, so a login or refresh in one is visible to the others.
- `inheritNativeSettings` defaults to `true` and copies only nested-field-validated inert settings such as native model defaults and compaction/retry settings, plus sanitized auth/model credentials. It never inherits `packages`, `extensions`, `skills`, `prompts`, `themes`, `npmCommand`, shell prefixes, unknown settings, or `!command` credentials/headers from `auth.json` or `models.json`. Set it to `false` to disable native settings/models inheritance completely.
- Automatic Pi skill, prompt-template, theme, context-file, and extension discovery is disabled. Selected One Works skills are loaded through explicit `--skill` paths.
- Pi does not currently expose a stable built-in MCP seam. Selected MCP servers produce a `skipped` diagnostic instead of silently installing a third-party extension.
- One Works maps plan, accept-edits, ask, dont-ask, and bypass permission modes through a managed permission extension. At direct/serverless preparation, an `allow_once` is atomically claimed from the private permission mirror and baked only into that Pi process, so a pre-spawn crash can only lose an authorization; a `deny_once` stays durable and is conservatively denied again after restart. Streaming sessions use the normal One Works six-choice interaction UI and persist new scoped decisions; if a configured permission-check server is unavailable, every Pi tool fails closed and the mirror is not read. Direct terminal sessions use Pi's native Allow/Deny prompt for the current call.
- `telemetry: off`, `disableVersionCheck: true`, and `offline: true` control Pi telemetry, version checks, and startup network access.
- User Pi extensions are loaded through explicit global paths only when `enableNativeExtensions: true` is explicit. Project `.pi/extensions` additionally require `projectTrust: always`; the default `projectTrust: never` keeps project discovery disabled. Extensions have the same privileges as local code and should be reviewed first. Custom extension tools must also be named in `tools.include`; unknown tools pass through the managed mutating-tool permission gate.

Run `oneworks adapter prepare pi` to download and verify the managed CLI. See
[Adapter CLI Installation and Versions](./adapter-cli.md) for version and binary overrides.
