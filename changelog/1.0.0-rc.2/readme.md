# One Works 1.0.0-rc.2

- Fix model provider catalog updates failing during installation from the module update screen, while returning stable client errors for malformed or unknown update targets.
- Prefer adapter packages from the current development workspace over stale managed caches, while preserving installed and packaged runtime cache precedence.
- Manage multiple Claude Code accounts through the official CLI login flow, isolated account profiles, portable or device-bound credential handling, cached usage, and Relay-safe account synchronization.
