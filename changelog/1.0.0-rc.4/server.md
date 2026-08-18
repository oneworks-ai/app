# @oneworks/server 1.0.0-rc.4

- Let session WebSockets connect before HTTP creation finishes without racing to create duplicate database records, and keep slow or cancelled creation attempts coordinated through completion.
