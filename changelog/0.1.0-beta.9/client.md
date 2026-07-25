# @oneworks/client 0.1.0-beta.9

- Added a host-owned External Control group in Settings where plugins can register native subpages while keeping existing plugin settings routes and rendering modes.
- Kept plugin settings state stable during source edits and package builds by using scoped plugin-client HMR instead of restarting the plugin runtime.
