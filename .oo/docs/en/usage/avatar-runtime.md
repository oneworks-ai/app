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

## Seed and parameter-level randomization

A Seed is versioned deterministic entropy, not a replacement for the definition. Each supported parameter independently chooses whether to follow the Seed, while the definition continues to store concrete resolved values. The editor records the Seed and linked fields in `metadata.generation`, so the authoring state survives editor and share-URL round trips.

```ts
import {
  AVATAR_SEED_FIELD_PATHS,
  resolveAvatarSeededOption,
  resolveSeededAvatarView
} from '@oneworks/avatar'

const seed = 'v1-agent-42'
const palette = resolveAvatarSeededOption(
  seed,
  AVATAR_SEED_FIELD_PATHS.palette,
  [
    'signal',
    'white',
    'coral'
  ]
)
const view = resolveSeededAvatarView(seed, definition.scene.view)
```

The same `seed + field path + candidate` always produces the same result. Fields use independent random domains; adding a candidate can select the new candidate for some Seeds without reshuffling results among existing candidates. Editing a field manually in the editor automatically disables Seed control for that field. Re-enabling it restores the stable value for the same Seed. Camera-frame shape remains URL-persistent and manually editable, but does not participate in Seed randomization.

The Cat template adds constrained Cat types such as Siamese, British Shorthair, Russian Blue, Orange Tabby, Cow Cat, and Black Cat. A type fixes its identifying geometry, material relationship, and coat rules while exposing only biologically plausible Seed domains. For example, Siamese keeps the face patch centered and its cream-and-brown material family fixed while allowing the patch dimensions to vary. Seeded view composition uses a consistent moderate scale and lower crop, varies horizontal placement, applies only a small bounded center-facing yaw and pitch, and keeps roll at zero. Manual movement or rotation freezes that concrete view by disabling its Seed binding.

The Cat template also exposes a first-class procedural **Coat pattern**. `scene.appearance.coatPattern` stores the algorithm (Random, Mackerel, Classic, Broken, or Spotted), separate algorithm and layout Seeds, density, thickness, jitter, symmetry, contrast, and breakup. The model's continuous base material wraps the whole head; one joined face-to-chin light region and stable feline landmarks such as the forehead M, eye lines, paired ear patches, and ear-root marks sit above it. Density controls the longer variable curves across the front, flanks, and rear; jitter controls how far their positions, lengths, bends, rotations, and left/right differences can drift from the canonical layout. Algorithm selection and layout follow Seed independently, so a fixed algorithm can still receive new stripe placement and curvature from the global Seed; manually editing a parameter freezes only that parameter. Renderers, framework adapters, and exports derive the pattern from the same configuration. The result is materialized into `scene.decals` only after an explicit **Convert to editable decals** action.

The face can enable a configurable highlight inside each eye. `scene.decals` adds vector color shapes that are projected onto a body or entity-part surface, so blush, mouth marks, badges, and similar details follow the same 3D pose and export path instead of becoming separate floating geometry. Use the `face` surface side for a mark that must stay aligned with the facial feature plane at extreme poses; the regular `front`, `left`, `right`, and `back` sides continue to follow the actual model surface.

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
