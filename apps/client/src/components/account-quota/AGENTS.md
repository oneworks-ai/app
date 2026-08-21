# Account Quota Components

This directory owns reusable account-quota presentation shared across client surfaces.

- `AccountQuotaPanel.tsx` renders quota windows, refresh state, and reset-credit actions. Reuse it from dialogs, account configuration, and other quota surfaces instead of rebuilding metric cards.
- `QuotaUsageRing.tsx` is the compact percentage indicator used by the panel and lightweight quota summaries.
- Keep quota windows and reset credits inside one shared card, separated by a single structural divider. The shared panel owns its border and background; its two sections own equal tokenized padding, and consumers must not split them back into separate cards or add compensating outer padding.
- Quota headings and window rows use the shared Material Symbols icon slot so labels begin on one text column. Translate adapter-provided legacy window/reset strings at this presentation boundary; do not expose English probe labels directly in localized UI.
- Keep the shared quota card mounted for known quota-capable accounts when authentication is missing or invalid. Retain any last-known quota (or the empty quota structure) and render the localized sign-in guidance inside the usage section instead of removing the surface.
- The reset-credit group is a native disclosure: keep its title and available count visible, keep its content collapsed by default, and expand the existing shared content in place. Consumers must not introduce a separate expansion default or duplicate the group.
- After reset-credit consumption, invalidate every `/api/adapters/accounts` cache variant for the active adapter so chat selectors that use different model keys receive the refreshed persisted quota snapshot. Do not revive the removed `/api/adapters/accounts-quota` cache key.
- Modal shells, route layout, and placement stay with their owning feature; only quota content and quota-specific actions belong here.

Run the focused account-quota tests and the tests for each consuming surface after changing this module.
