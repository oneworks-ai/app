# Kiro Adapter

This package owns the native Kiro CLI integration. Use it for CLI acquisition, the isolated `KIRO_HOME`, ACP lifecycle and event projection, Kiro custom-agent assets, and native hook translation.

Read `.oo/rules/ADAPTERS.md` and `.oo/rules/adapter-design/README.md` before changing runtime behavior. The structured runtime is `kiro-cli acp`; do not parse interactive terminal rendering as a machine protocol. Amazon Q compatibility stays a probed `q` executable alias and must not become a second adapter.

Useful verification entry points are `packages/adapters/kiro/__tests__`, workspace asset tests, task runtime tests, CLI prepare tests, and desktop/client registry tests.
