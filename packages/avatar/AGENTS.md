# Avatar Package Guide

`packages/avatar` owns the reusable OneWorks avatar renderer.

- `src/avatar.ts`: pure SVG generator, pixel glyph definitions, palettes, presets, and low-level data URI helpers.
- `src/seed.ts`: deterministic seed-to-avatar helpers for client UI.
- `__tests__/`: renderer and seed behavior coverage.

Avatar glyphs must remain SVG `rect` geometry. Do not replace the face characters with web fonts, canvas text, or raster images. Keep reusable runtime APIs here; the `assets/avatar` project is only the preview/export surface.

Deployment:

- `assets/avatar` is a submodule of `oneworks-ai/avatar`.
- The Pages site is rebuilt when this package or the avatar asset app changes.
- `assets/avatar` is not part of the root app pnpm workspace. Its deployment installs the Avatar repository's own toolchain, checks out the app repository as `app-source`, and builds with aliases to `packages/avatar` source and `packages/route-layout` CSS from that app commit.
- If glyphs, palettes, seed mapping, or exported renderer APIs change, run the package tests and the asset app build before updating the submodule pointer.

Validation:

- `pnpm -C packages/avatar build`
- `pnpm -C packages/avatar test`
