# @oneworks/server 1.0.0-rc.5

- Let session WebSockets connect before HTTP creation finishes without racing to create duplicate database records, and keep slow or cancelled creation attempts coordinated through completion.
- Keep versioned channel configuration safe when credentials come from local environment files: unresolved environment references now leave the channel disconnected instead of attempting a platform connection.
