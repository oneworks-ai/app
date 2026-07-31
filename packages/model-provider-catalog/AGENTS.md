# Model Provider Catalog

This package owns versioned, runtime-independent metadata for model providers: provider identities, official endpoints, default model fallbacks, portals, capabilities, adapter compatibility, and host matching rules.

- Keep network access, credentials, caching, and active-package loading in `apps/server/src/services/model-providers/`.
- Keep provider resolution and model-service merging helpers in `packages/utils/src/model-providers.ts`.
- Bump and publish this package independently when provider metadata changes do not require application runtime changes.
- Validate catalog schema and referential integrity in `src/index.ts`; consumers must reject incompatible managed catalogs and fall back to the bundled catalog.
- Run `pnpm --filter @oneworks/model-provider-catalog test` for catalog validation changes.
