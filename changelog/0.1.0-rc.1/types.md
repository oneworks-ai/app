# Shared Types

- Add the shared versioned Relay device transport runtime contract: v1 WebSocket and v2 long-poll service discovery now use one validation and same-origin normalization boundary, exposed through a browser-safe `@oneworks/types/relay-device-transport` subpath.
- Make the package build self-contained by declaring its direct `esbuild` build dependency for isolated publishing.
