# Goose history fixture provenance

The JSON field shapes in `history-list.json` and `history-export.json` were captured on 2026-08-13 from the official Goose CLI v1.46.0 (`goose 1.46.0`) with an isolated `GOOSE_PATH_ROOT`. The source checkout used to confirm the public command implementations and schemas was `aaif-goose/goose@11deb564d09db782a17878af7cfafd299d9fa461`.

Source freeze evidence:

- official workspace version: `1.46.0` (`Cargo.toml`)
- source commit: `11deb564d09db782a17878af7cfafd299d9fa461` (2026-08-13T02:45:24Z)
- ACP client boundary: stable protocol v1 through `@agentclientprotocol/sdk@1.3.0`
- runtime probe: `goose acp --help`, `goose session list --help`, `goose session export --help`, and `goose --version`; no provider login was performed
- release probe: exact v1.46.0 asset names and GitHub release metadata `digest: sha256:<64 lowercase hex>`; no signature asset was published, so installation requires the digest and does not claim signature verification
- public source confirmation: `SessionCommand::List` accepts `--format json`; `SessionCommand::Export` accepts `--session-id` and `--format json`; stdout export serializes the public `Session` structure

Probe boundary:

```sh
GOOSE_PATH_ROOT="$isolated_probe_root" goose --version
GOOSE_PATH_ROOT="$isolated_probe_root" goose session list --format json
GOOSE_PATH_ROOT="$isolated_probe_root" goose session export --session-id "$probe_session_id" --format json
```

Session ids, working directories, titles, timestamps, prompts, tool inputs, and tool results were replaced with deterministic non-secret values. Field names, nesting, roles, public command arguments, timestamp units, and tool request/result shapes were retained. No SQLite file or private Goose state format was inspected.
