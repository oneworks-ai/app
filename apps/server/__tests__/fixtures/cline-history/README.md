# Sanitized Cline 3.0.54 history fixture

These files were captured from an isolated Cline CLI 3.0.54 ACP lifecycle probe against a local fake provider. The
database is stored as base64 because it is a binary SQLite artifact. It preserves the released `sessions` schema;
all prompts (including the captured `system_prompt` body), paths, process identifiers, account data, provider
endpoints, and credentials were removed or replaced. The top-level `system_prompt` key remains with the literal
`[sanitized]` value so the released schema discriminator stays representative without retaining upstream content.

- Decoded database SHA-256: `4c0644c5f815e96838f4e154ae6b4565902d961d42029b56fee695164737c395`
- Messages artifact SHA-256: `2403c0ba5734cabc7906f5eeb624ccad0b387b2c4e73c83a40ff877c7537a826`

Tests decode the database into an isolated temporary Cline data root and verify that preview and import never change
the database, messages artifact, or any SQLite WAL/SHM sidecar state. Multi-project and subagent rows used by the
contract tests are sanitized derivatives inserted into a temporary copy of this same released schema.
