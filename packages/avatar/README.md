# @oneworks/avatar

[English](README.md) | [简体中文](README.zh-Hans.md)

`@oneworks/avatar` is the legacy OneWorks 2D pixel-emoticon SVG renderer. It provides deterministic, DOM-free SVG and data-URI helpers for application placeholders.

It is not the OneWorks 3D Avatar runtime. For the 3D editor, editable share URLs, SVG/PNG/GIF export, and current integration boundaries, see [OneWorks Avatar](https://github.com/oneworks-ai/avatar#readme).

## Install

```bash
pnpm add @oneworks/avatar
```

## React usage

```tsx
import { useMemo } from 'react'
import { createSeededAvatarDataUri } from '@oneworks/avatar'

export function AgentAvatar({ id, name }: { id: string; name: string }) {
  const src = useMemo(() => createSeededAvatarDataUri({
    seed: `agent:${id}`,
    size: 128,
    title: `${name} avatar`
  }), [id, name])

  return <img src={src} width={64} height={64} alt={`${name} avatar`} />
}
```

## Node or server-side SVG

The SVG helpers do not require a DOM:

```ts
import { writeFile } from 'node:fs/promises'
import {
  createAvatarSvg,
  getAvatarPalette,
  isSupportedAvatarEmoticon
} from '@oneworks/avatar'

const emoticon = '0w0'
if (!isSupportedAvatarEmoticon(emoticon)) throw new Error('Unsupported avatar')

await writeFile('avatar.svg', createAvatarSvg({
  emoticon,
  palette: getAvatarPalette('signal'),
  backgroundStyle: 'gradient',
  showShadow: true,
  size: 256,
  title: 'Codex avatar'
}), 'utf8')
```

## Exports

- `@oneworks/avatar`: renderer, palettes, glyph parts, presets, and seed helpers.
- `@oneworks/avatar/avatar`: low-level SVG renderer and pixel glyph data.
- `@oneworks/avatar/seed`: deterministic seed-to-avatar helpers.

Prefer the root import unless a narrow subpath is necessary. Do not deep-import `dist` files.

## Stability notes

- Seeded output is deterministic within a package version. If the preset set or ordering changes, the same seed may resolve differently in a later version. Pin the package version for long-lived identity, or persist the resolved emoticon and palette ID.
- The package renders the legacy pixel avatar with a background. It does not provide transparent 3D output, PNG/GIF export, camera framing, entity parts, or animation.
- Validate custom emoticons with `isSupportedAvatarEmoticon` before calling the renderer.

## Maintenance

- Edit glyph geometry, palettes, presets, and SVG output in `packages/avatar/src/avatar.ts`.
- Edit deterministic seed mapping in `packages/avatar/src/seed.ts`.
- Edit the 3D editor and browser export UI in the `assets/avatar` submodule.
