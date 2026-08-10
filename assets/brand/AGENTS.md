# Product Brand Catalog

This directory owns the application-side, machine-readable brand catalog and
the stable source assets that downstream brand tooling consumes.

- `catalog.json` is the product fact source for adapters, model services, and
  channels that may appear in catalog-driven brand scenes.
- `adapters/` and `channels/` hold stable, repository-owned source files. Keep
  adapter labels aligned with `apps/client/src/resources/adapters.ts` and use
  the official adapter package mark when one exists.
- Adding or removing a built-in adapter requires updating the catalog in the
  same change. The client catalog test rejects missing or stale adapter rows.
- Brand Studio discovers this catalog through its existing
  `sync-product-catalog` pipeline. Do not copy entries directly into generated
  Studio HTML or PNG files.
- Product ordering, `enabled`, and `featured` are explicit product decisions;
  file-system discovery must not infer them.

The generated Studio, exported PNGs, and distribution mirrors remain owned by
the `assets/brand-studio` repository and its declarative distribution catalog.
