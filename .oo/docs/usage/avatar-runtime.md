# Avatar Runtime、React 与 Vue

返回 [Avatar 总览](./avatar.md)，或继续阅读[原生 JavaScript 与 Web Component 接入](./avatar-web.md)。

## Definition 与自定义动画

`AvatarDefinition` 使用 schema `oneworks.avatar`，当前 definition version 为 `1`。Definition 包含承载实体部件、面部、姿态、相机、光照和材质效果的 scene，并可另外携带可选动画库；它是渲染器和编辑器之间的可携带数据源。

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

应用可以传入多个动画库。库由 group 和 clip 组成，播放时也可以直接传 clip。`relative` 会把每个姿态维度各自第一次显式出现的值锚定到当前场景；`absolute` 使用动画中记录的绝对值。

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

v1 动画 patch 支持 `colorGrade`、`face`，以及 `view` 的 `pitch`、`yaw`、`positionX`、`positionY`。`roll`、`scale`、灯光和实体部件暂不属于 v1 动画 patch；校验器会拒绝未知或类型错误的字段。keyframe 必须位于 `0..durationMs`，每个实际时间段必须在 100–8000ms 内；这包括延迟首帧、相邻帧、Once 尾部停留和 Loop 回环。延迟首帧会从当前场景过渡，Once 动画会在末帧保持到完整 duration。

## React

`Avatar` 和 `AvatarEditor` 接收同一个 definition 和动画库。编辑器是在线产品使用的完整编辑器，不是简化表单。

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
        locale='zh-Hans'
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
        播放
      </button>
    </>
  )
}
```

渲染器 ref 提供 `play`、`pause`、`resume`、`seek`、`stop`、`capture`、`getDefinition` 与 `setDefinition`。编辑器 ref 提供 `focus`、`getDefinition` 与 `setDefinition`。事件使用 `onAnimationStart`、`onAnimationEnd`、`onDefinitionChange` 等 callback props。

## Vue

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
    locale="zh-Hans"
    @definition-change="definition = $event"
  />
</template>
```

Vue 通过 `expose` 提供相同的渲染器与编辑器方法；事件使用 `animation-start`、`animation-end`、`definition-change` 等 emits。

手动旋转或移动交互会停止当前动画。`autoplay` 只会在 animation/autoplay 输入变化时启动，不会在手势更新 definition 后擅自重启。
