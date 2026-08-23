# Avatar Runtime, React, and Vue

Return to the [Avatar overview](./avatar.md), or continue to the [Vanilla JavaScript and Web Component guide](./avatar-web.md).

## Definitions and custom animations

`AvatarDefinition` uses the `oneworks.avatar` schema and definition version `1`. A definition contains a scene with entity parts, face, pose, camera, lighting, and material effects, and may additionally carry an optional animation library. It is the portable data source shared by the renderer and editor.

```ts
import {
  createDefaultAvatarDefinition,
  parseAvatarDefinition,
  serializeAvatarDefinition
} from '@oneworks/avatar'

const definition = createDefaultAvatarDefinition()
const json = serializeAvatarDefinition(definition)
const restored = parseAvatarDefinition(json)
```

The face can enable a configurable highlight inside each eye. `scene.decals` adds vector color shapes that are projected onto a body or entity-part surface, so blush, mouth marks, badges, and similar details follow the same 3D pose and export path instead of becoming separate floating geometry.

```ts
const decorated = {
  ...definition,
  scene: {
    ...definition.scene,
    face: {
      ...definition.scene.face,
      eyeHighlight: {
        color: '#ffffff',
        enabled: true,
        offsetX: -18,
        offsetY: -20,
        opacity: 96,
        size: 30
      }
    },
    decals: [
      {
        color: '#f29a93',
        height: 18,
        id: 'blush-left',
        label: 'Left blush',
        opacity: 88,
        rotation: -6,
        shape: 'ellipse',
        targetPartId: null,
        width: 30,
        x: -50,
        y: 31
      }
    ]
  }
}
```

Applications can supply multiple animation libraries. A library contains groups and clips, and a clip may also be passed directly to playback. A `relative` clip anchors each pose dimension at that dimension's first explicitly authored value; an `absolute` clip uses the recorded values directly.

```ts
import type { AvatarAnimationLibrary } from '@oneworks/avatar'

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

## React

`Avatar` and `AvatarEditor` consume the same definition and animation libraries. The editor is the complete editor used by the hosted product, not a reduced settings form.

```tsx
import { createDefaultAvatarDefinition } from '@oneworks/avatar'
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

The renderer ref provides `play`, `pause`, `resume`, `seek`, `stop`, `capture`, `getDefinition`, and `setDefinition`. The editor ref provides `focus`, `getDefinition`, and `setDefinition`. Use callback props such as `onAnimationStart`, `onAnimationEnd`, and `onDefinitionChange` for events.

## Vue

```vue
<script setup lang="ts">
import { createDefaultAvatarDefinition } from '@oneworks/avatar'
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

Vue exposes the same renderer and editor methods through `expose`. Events use Vue emits such as `animation-start`, `animation-end`, and `definition-change`.

A manual rotate or move interaction stops the active animation. `autoplay` starts only when the animation/autoplay input changes and does not silently restart after a gesture updates the definition.
