# Avatar in Vanilla JavaScript and Web Components

Return to the [Avatar overview](./avatar.md), or see [definitions, animations, React, and Vue](./avatar-runtime.md).

## Vanilla JavaScript

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

## Web Components

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

## Controllers, events, and capture

React refs, Vue exposed methods, and Vanilla mounts provide `play`, `pause`, `resume`, `seek`, `stop`, `getDefinition`, `setDefinition`, and `capture({ format, size, background, frame })`. `<oneworks-avatar>` provides the same playback and capture methods, but reads and writes the definition through its `definition` DOM property instead of `getDefinition()` / `setDefinition()`.

Editor refs, Vue exposed methods, and Vanilla mounts provide `focus`, `getDefinition`, and `setDefinition`; `<oneworks-avatar-editor>` instead uses `focus()` and its `definition` property.

Events follow each adapter's native mechanism: React uses callback props; Vue uses emits; Vanilla mount hosts and Custom Elements dispatch `avatarready`, `animationstart`, `animationloop`, `animationend`, `avatarerror`, and `avatarchange`. Editors dispatch the `editoready` and `avatarchange` DOM CustomEvents.

A manual rotate or move interaction stops the active animation. `autoplay` starts only when the animation/autoplay input changes and does not silently restart after a gesture updates the definition.

## Current boundaries

- React, Vue, Vanilla JavaScript, and Web Components all use the hosted editor's geometric SVG renderer. They do not reconstruct the avatar as a separate 2D drawing.
- There is no public iframe/embed URL or `postMessage` protocol yet. Embed editing with `AvatarEditor`, `OneWorksAvatarEditor`, `createAvatarEditor`, or `<oneworks-avatar-editor>`.
- A share URL remains opaque UI persistence state. Do not hand-author or parse `entityParts`, `animationData`, or other query parameters.
- `AvatarDefinition` is runtime data, an editor URL is an editable source, and an exported asset URL is a directly displayable static or animated file. Do not interchange them.
