# @oneworks/icon

One Works icon runtime package.

## Exports

- `@oneworks/icon/core`: deterministic seed, motion cycle, Mobius mesh, and color helpers
- `@oneworks/icon/canvas`: browser Canvas renderer for animated icon surfaces
- `@oneworks/icon/svg`: static SVG renderer
- `@oneworks/icon/loader`: lightweight browser mount helper
- `@oneworks/icon/presets`: shared theme, mode, and default constants

## Browser Loader

```ts
import { mountOneWorksIconLoader } from '@oneworks/icon/loader'

const handle = mountOneWorksIconLoader(document.querySelector('#icon')!, {
  appearance: 'system',
  background: true,
  motion: true,
  seed: 'brand-v1',
  theme: 'industrial'
})

handle.update({ theme: 'matrix' })
```

For static GitHub Pages demos, pin the npm CDN version instead of using `latest`:

```html
<script type="module">
  import { mountOneWorksIconLoader } from 'https://esm.sh/@oneworks/icon@0.1.0-alpha.0/loader'

  mountOneWorksIconLoader(document.querySelector('#icon'), {
    theme: 'industrial',
    seed: 'brand-v1'
  })
</script>
```
