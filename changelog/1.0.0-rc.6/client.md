# @oneworks/client 1.0.0-rc.6

- Keep workspace-owned plugin navigation available in packaged Desktop workspaces while preserving manager-owned global chrome and workspace runtime isolation.
- Make adapter accounts easier to manage with a searchable adapter catalog, dedicated account-detail routes, cancelable login progress, and richer account identity, plan, and quota previews.
- Restore the Chat Rooms sidebar entry in packaged Desktop compatibility workspaces by using the plugin runtime role instead of URL shape as workspace authority, recover plugin navigation automatically when the workspace server becomes available after the first snapshot request, keep the last-good entry stable through watch reconnects and plugin hot reloads, and align its create card with the active theme surface.
- Unify configuration navigation with route-backed General and Conversation task tabs, responsive model-service and channel collections, and detail tabs that keep the active choice visible on narrow screens.
- Refine configuration collections with searchable preset and action cards, responsive drag reordering, Provider/Profile model-service setup with multiple API keys, per-profile quota summaries with a "view all" path, compatibility for independent services, consistent platform icons, and stable hover actions that do not shift card content.
