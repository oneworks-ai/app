# @oneworks/adapter-claude-code 1.0.0-rc.4

- Run the default Claude Desktop or CLI login alongside multiple isolated `CLAUDE_CONFIG_DIR` accounts, with
  concurrent sessions, deterministic same-identity deduplication, and default-account remapping.
- Keep account mutations fail-closed when the installed Claude CLI cannot prove credential isolation, and limit
  logout to the selected isolated profile without signing out the shared default native credential.
