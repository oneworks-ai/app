# Relay Plugin

- Relay devices now negotiate their transport explicitly: durable WebSocket deployments keep the compatible v1 WebSocket capability, while Vercel advertises a bounded HTTP long-poll capability.
- Long-poll renews device presence in the authenticated JSON request body and spaces idle polls for bounded serverless operation.
- Session snapshots now use a 30-second local diff check, immediate changed-data publish, and a six-hour unchanged-data safety refresh.
