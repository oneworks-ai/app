# Relay Plugin

- Prefer a versioned Relay-advertised device transport for registration and bearer API traffic without changing the public browser-auth origin.
- Keep one hibernation-friendly WebSocket control channel per Relay loop lease. Online devices send 30-second heartbeats through the socket, refresh snapshots every five minutes, reconcile queued jobs once on connection, and coalesce later wake notifications. Disconnected or older servers use an independent 45-second HTTP heartbeat plus one bounded 60-second long poll with a 90-120 second retry floor.
