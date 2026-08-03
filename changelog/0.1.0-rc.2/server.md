# Relay Server

- Node Relay Server now accepts native WebSocket control upgrades at `/api/relay/devices/control` with per-frame device-token and permission checks.
- Cloudflare Relay control cadence is server-advertised for Durable Object hibernation, reducing idle wake writes while retaining a fifteen-minute online window.
- Vercel Relay uses a 50-second maximum long poll and a 250-second idle retry cadence (about 288 invocations, 14,400 function-seconds, and 3,168 reads per device/day by default); no WebSocket fallback is attempted across deployment platforms.
