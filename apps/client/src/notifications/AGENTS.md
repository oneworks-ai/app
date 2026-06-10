# Notifications Module

This module owns host-level UI notifications rendered in the bottom-right queue.

- `NotificationProvider.tsx`: global provider, queue state, source muting, and public notification API.
- `NotificationQueue.tsx`: visual queue and card interactions.
- `notification-types.ts`: shared client-side notification contract for host code and plugin runtime.
- `notification-store.ts`: source key helpers and local UI preference persistence.

Plugins must publish user-facing prompts through `ctx.notifications.show(...)`; the plugin runtime injects the source so plugins cannot spoof another source. Keep markdown rendering inside the host queue via `MarkdownContent`, and keep source muting as a UI preference instead of plugin options.
