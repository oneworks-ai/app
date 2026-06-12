# @oneworks/avatar

OneWorks avatar pixel emoticon SVG renderer.

The interactive preview/export site lives in the `oneworks-ai/avatar` repository and is mounted in the app monorepo as `assets/avatar`. The site imports this package from the app workspace so preview output matches client runtime output.

## Exports

- `@oneworks/avatar`: avatar SVG renderer, palettes, glyph parts, presets, and seed helpers
- `@oneworks/avatar/avatar`: low-level avatar SVG renderer and pixel glyph data
- `@oneworks/avatar/seed`: deterministic seed-to-avatar helpers for app UI

## Usage

```ts
import { createSeededAvatarDataUri } from '@oneworks/avatar'

const avatar = createSeededAvatarDataUri({
  seed: 'agent-room:codex',
  size: 128
})
```

## Maintenance

- Edit glyph geometry, palettes, presets, and SVG output in `packages/avatar/src/avatar.ts`.
- Edit deterministic client mapping in `packages/avatar/src/seed.ts`.
- Edit preview/export UI in the `assets/avatar` submodule.
- The app repository triggers the avatar Pages deployment only when `packages/avatar/**` or `assets/avatar/**` changes.
