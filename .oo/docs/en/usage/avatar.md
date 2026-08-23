# Avatar Editor and Developer Integration

OneWorks Avatar is a browser-based geometric 3D avatar editor with developer components built on the same renderer as the hosted product. Save an editable source, export SVG/PNG/GIF, or render and edit a versioned Avatar definition directly in React, Vue, and Vanilla JavaScript applications.

Open the hosted editor at [oneworks.cloud/avatar](https://oneworks.cloud/avatar/).

## Create and export

1. Choose a built-in avatar on the home page, or enter the editor to build your own geometric character.
2. Adjust pose, position, scale, face, materials, lighting, shadows, outline, and animation.
3. Enter camera mode and choose the output size, frame, and background.
4. Copy SVG or download SVG, PNG, or animated GIF.

The editor supports Simplified Chinese and English. Its theme can follow the system or be switched manually between light and dark.

| Format | Use                 | Behavior                                                                                      |
| ------ | ------------------- | --------------------------------------------------------------------------------------------- |
| SVG    | Static vector asset | Preserves the current 3D scene projection, camera background, and frame clipping.             |
| PNG    | Static raster asset | Supports transparent backgrounds for application avatars, social platforms, and design files. |
| GIF    | Animated asset      | Exports the selected animation and is unavailable until an animation is selected.             |

Export sizes are 128, 256, and 512 pixels. The camera background can be a color or transparent, and the camera frame can be square, rounded, or circular. Pixels outside rounded and circular frames remain transparent.

## Developer integration

The new 3D Runtime is currently versioned `0.1.0-alpha.0`. Its source and clean packed-consumer verification are public in [`oneworks-ai/avatar`](https://github.com/oneworks-ai/avatar). The four new packages have not completed their first npm registry publication, so do not run same-name install commands yet. The imports below are implemented and verified public alpha contracts, not an unimplemented proposal.

| Package                  | Purpose                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `@oneworks/avatar-core`  | Versioned definitions, validation, serialization, and animation runtime. |
| `@oneworks/avatar-react` | React `Avatar` renderer and full `AvatarEditor`.                         |
| `@oneworks/avatar-vue`   | Vue `OneWorksAvatar` and `OneWorksAvatarEditor`.                         |
| `@oneworks/avatar-web`   | Vanilla JavaScript mounts and explicitly registered Web Components.      |

The existing `@oneworks/avatar` package is intentionally separate: it remains the legacy 2D pixel-emoticon SVG renderer and does not consume 3D definitions.

### Definitions and custom animations

`AvatarDefinition` uses the `oneworks.avatar` schema and definition version `1`. A definition contains a scene with entity parts, face, pose, camera, lighting, and material effects, and may additionally carry an optional animation library. It is the portable data source shared by the renderer and editor.

```ts
import {
  createDefaultAvatarDefinition,
  parseAvatarDefinition,
  serializeAvatarDefinition
} from '@oneworks/avatar-core'

const definition = createDefaultAvatarDefinition()
const json = serializeAvatarDefinition(definition)
const restored = parseAvatarDefinition(json)
```

Applications can supply multiple animation libraries. A library contains groups and clips, and a clip may also be passed directly to playback. A `relative` clip anchors each pose dimension at that dimension's first explicitly authored value; an `absolute` clip uses the recorded values directly.

```ts
import type { AvatarAnimationLibrary } from '@oneworks/avatar-core'

export const supportAnimations = {
  id: 'support',
  label: 'Support animations',
  groups: {
    attention: {
      label: 'Attention',
      defaultClip: 'acknowledge',
      clips: {
        acknowledge: {
          anchor: 'relative',
          durationMs: 900,
          playback: 'once',
          keyframes: [
            { atMs: 0, patch: { view: { pitch: 0, yaw: 0 } } },
            {
              atMs: 250,
              easing: 'ease-in-out',
              patch: { view: { pitch: .22 } }
            },
            {
              atMs: 900,
              easing: 'ease-out',
              patch: { view: { pitch: 0, yaw: 0 } }
            }
          ]
        }
      }
    }
  }
} satisfies AvatarAnimationLibrary
```

Version 1 animation patches support `colorGrade`, `face`, and the `pitch`, `yaw`, `positionX`, and `positionY` fields of `view`. `roll`, `scale`, lighting, and entity parts are not version 1 animation-patch fields; validation rejects unknown or incorrectly typed fields. Keyframes must be within `0..durationMs`, and every real segment must be 100–8000ms, including a delayed first frame, adjacent frames, a Once tail hold, and a Loop closing edge. A delayed first keyframe transitions from the current scene, and a Once clip holds its final frame through the full duration.

### React

`Avatar` and `AvatarEditor` consume the same definition and animation libraries. The editor is the complete editor used by the hosted product, not a reduced settings form.

```tsx
import { createDefaultAvatarDefinition } from '@oneworks/avatar-core'
import { Avatar, AvatarEditor } from '@oneworks/avatar-react'
import type { AvatarHandle } from '@oneworks/avatar-react'
import { useRef, useState } from 'react'
import '@oneworks/avatar-react/style.css'

export function AvatarWorkspace() {
  const [definition, setDefinition] = useState(createDefaultAvatarDefinition)
  const avatar = useRef<AvatarHandle>(null)

  return (
    <>
      <Avatar
        ref={avatar}
        definition={definition}
        animationLibraries={[supportAnimations]}
        interactive
        onDefinitionChange={setDefinition}
        theme='system'
      />
      <AvatarEditor
        definition={definition}
        animationLibraries={[supportAnimations]}
        locale='en'
        onDefinitionChange={setDefinition}
        theme='system'
      />
      <button
        onClick={() =>
          avatar.current?.play({
            libraryId: 'support',
            groupId: 'attention',
            clipId: 'acknowledge'
          })}
      >
        Play
      </button>
    </>
  )
}
```

### Vue

```vue
<script setup lang="ts">
import { createDefaultAvatarDefinition } from '@oneworks/avatar-core'
import { OneWorksAvatar, OneWorksAvatarEditor } from '@oneworks/avatar-vue'
import { ref } from 'vue'
import '@oneworks/avatar-vue/style.css'

const definition = ref(createDefaultAvatarDefinition())
</script>

<template>
  <OneWorksAvatar
    :definition="definition"
    :animation-libraries="[supportAnimations]"
    interactive
    @definition-change="definition = $event"
  />
  <OneWorksAvatarEditor
    :definition="definition"
    :animation-libraries="[supportAnimations]"
    locale="en"
    @definition-change="definition = $event"
  />
</template>
```

The renderer component exposes `play`, `pause`, `resume`, `seek`, `stop`, `capture`, `getDefinition`, and `setDefinition`. The editor exposes `focus`, `getDefinition`, and `setDefinition`.

### Vanilla JavaScript

```ts
import { createAvatar, createAvatarEditor } from '@oneworks/avatar-web'
import '@oneworks/avatar-web/style.css'

const previewHost = document.querySelector('#avatar')!
const editorHost = document.querySelector('#avatar-editor')!

const avatar = createAvatar(previewHost, {
  definition,
  animationLibraries: [supportAnimations],
  interactive: true,
  theme: 'system'
})
const editor = createAvatarEditor(editorHost, {
  definition,
  animationLibraries: [supportAnimations],
  locale: 'en',
  theme: 'system'
})

editorHost.addEventListener('avatarchange', event => {
  avatar.setDefinition((event as CustomEvent).detail.definition)
})

await Promise.all([avatar.ready, editor.ready])
await avatar.play({
  libraryId: 'support',
  groupId: 'attention',
  clipId: 'acknowledge'
})
```

Call `destroy()` when a mount is no longer needed. The renderer mount also provides `update()`, `capture()`, and playback controls; the editor mount provides `update()`, `focus()`, `getDefinition()`, and `setDefinition()`.

### Web Components

Importing the module does not register custom elements. Applications call the registration function once, avoiding an unexpected global `customElements` side effect.

```ts
import { registerAvatarElements } from '@oneworks/avatar-web/elements'
import '@oneworks/avatar-web/style.css'

registerAvatarElements()

const avatar = document.querySelector('oneworks-avatar')!
const editor = document.querySelector('oneworks-avatar-editor')!

avatar.definition = definition
avatar.animationLibraries = [supportAnimations]
editor.definition = definition
editor.animationLibraries = [supportAnimations]
```

```html
<oneworks-avatar interactive theme="dark"></oneworks-avatar>
<oneworks-avatar-editor locale="en" theme="dark"></oneworks-avatar-editor>
```

Pass complex objects through DOM properties. Attributes carry only simple values such as `autoplay`, `interactive`, `theme`, and `locale`. Both elements retain their latest definition across disconnect and reconnect.

### Controllers, events, and capture

React refs, Vue exposed methods, and Vanilla mounts provide `play`, `pause`, `resume`, `seek`, `stop`, `getDefinition`, `setDefinition`, and `capture({ format, size, background, frame })`. `<oneworks-avatar>` provides the same playback and capture methods, but reads and writes the definition through its `definition` DOM property instead of `getDefinition()` / `setDefinition()`.

Editor refs, Vue exposed methods, and Vanilla mounts provide `focus`, `getDefinition`, and `setDefinition`; `<oneworks-avatar-editor>` instead uses `focus()` and its `definition` property.

Events follow each adapter's native mechanism: React uses callback props such as `onAnimationStart`, `onAnimationEnd`, and `onDefinitionChange`; Vue emits `animation-start`, `animation-end`, and `definition-change`; Vanilla mount hosts and Custom Elements dispatch `avatarready`, `animationstart`, `animationloop`, `animationend`, `avatarerror`, and `avatarchange`, while editors dispatch the `editoready` and `avatarchange` DOM CustomEvents.

A manual rotate or move interaction stops the active animation. `autoplay` starts only when the animation/autoplay input changes and does not silently restart after a gesture updates the definition.

### Current boundaries

- React, Vue, Vanilla JavaScript, and Web Components all use the hosted editor's geometric SVG renderer. They do not reconstruct the avatar as a separate 2D drawing.
- There is no public iframe/embed URL or `postMessage` protocol yet. Embed editing with `AvatarEditor`, `OneWorksAvatarEditor`, `createAvatarEditor`, or `<oneworks-avatar-editor>`.
- A share URL remains opaque UI persistence state. Do not hand-author or parse `entityParts`, `animationData`, or other query parameters.
- `AvatarDefinition` is runtime data, an editor URL is an editable source, and an exported asset URL is a directly displayable static or animated file. Do not interchange them.

## Save the editable source and application asset

Even when an application uses the Runtime, keep editable and deployable sources separately:

```ts
interface AvatarAssetRecord {
  definition: AvatarDefinition
  editorUrl?: string
  assetUrl?: string
  format?: 'svg' | 'png' | 'gif'
}
```

- `definition` drives Runtime rendering and programmatic animation.
- `editorUrl` is the complete share URL produced by the editor; store it as an opaque value.
- `assetUrl` points to an exported file on a static asset host or media store.
- The editor URL is not an image URL and should not be used as `<img src>`.

## Agent Skill

The Avatar repository includes the `oneworks-avatar` Agent Skill for creating, debugging, exporting, and integrating avatars:

```bash
npx skills@latest add oneworks-ai/avatar
```

The Skill uses the real editor and its 3D scene model instead of redrawing results through an image generator.

## Source, local development, and deployment

The legacy pixel renderer lives in [`oneworks-ai/app`](https://github.com/oneworks-ai/app) under `packages/avatar`. The 3D editor, Runtime, framework adapters, and export pipeline live in [`oneworks-ai/avatar`](https://github.com/oneworks-ai/avatar).

The Avatar repository is mounted into the app repository as the `assets/avatar` submodule. It builds independently from the app root workspace while using an `app-source` checkout or symlink for shared package source.

```bash
pnpm install --no-frozen-lockfile
ln -s /path/to/oneworks-app app-source
ONEWORKS_APP_SOURCE_DIR=app-source pnpm dev
ONEWORKS_APP_SOURCE_DIR=app-source pnpm test
ONEWORKS_APP_SOURCE_DIR=app-source pnpm typecheck:sdk
ONEWORKS_APP_SOURCE_DIR=app-source pnpm smoke:sdk
```

The Avatar page is published by the Avatar repository's `deploy-avatar.yml` workflow. The app repository triggers it when `assets/avatar`, `assets/avatar/**`, `packages/avatar/**`, or `.github/workflows/deploy-avatar.yml` changes. The main docs workflow publishes this page from `.oo/docs`.
