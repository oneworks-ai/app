# Avatar Runtime、React 与 Vue

返回 [Avatar 总览](./avatar.md)，或继续阅读[原生 JavaScript 与 Web Component 接入](./avatar-web.md)。

## Definition 与自定义动画

`AvatarDefinition` 使用 schema `oneworks.avatar`，当前 definition version 为 `1`。Definition 包含承载实体部件、面部、姿态、相机、光照和材质效果的 scene，并可另外携带可选动画库；它是渲染器和编辑器之间的可携带数据源。

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

## Seed 与参数级随机

Seed 是版本化的确定性熵，不替代 definition。每个支持随机的参数独立选择是否跟随 Seed；手动值仍作为具体值保存在 definition 中。编辑器会在 `metadata.generation` 记录 Seed 和跟随字段，切换或分享 URL 后仍可继续编辑。

```ts
import {
  AVATAR_SEED_FIELD_PATHS,
  resolveAvatarSeededOption,
  resolveSeededAvatarView
} from '@oneworks/avatar'

const seed = 'v1-agent-42'
const paletteOptions = ['signal', 'white', 'coral']
const { palette: paletteField } = AVATAR_SEED_FIELD_PATHS
const palette = resolveAvatarSeededOption(seed, paletteField, paletteOptions)
const view = resolveSeededAvatarView(seed, definition.scene.view)
```

相同 `seed + 字段路径 + 候选值` 始终得到同一个结果。不同字段使用独立随机域；新增候选只可能让一部分 Seed 选择新候选，不会重排旧候选之间的结果。编辑器中手动操作某个字段会自动关闭该字段的 Seed 跟随，重新开启则恢复同一 Seed 下的稳定值。相框形状仍会写入 URL，也可手动编辑，但不会参与 Seed 随机。

猫模板还提供暹罗猫、英短、蓝猫、大橘、奶牛猫与纯黑猫等受约束的猫咪类型。类型会固定识别性几何、材质关系和毛纹规则，只把符合真实品种特征的范围交给 Seed。例如暹罗猫的脸部色块始终居中，奶油色与深棕色搭配固定，仅允许色块尺寸在合理区间内变化。Seed 控制的视图构图使用统一的适中大小和下沉裁切，只改变左右位置，并在朝向画面中心的基础上加入小幅受限 yaw / pitch；roll 始终为零。用户手动移动或旋转后会自动关闭该视图的 Seed 跟随并保留具体值。

猫模型还提供第一类的程序化 **毛色花纹**。`scene.appearance.coatPattern` 保存算法（随机、鱼骨纹、经典纹、断裂纹、斑点纹）、算法 Seed、纹样布局 Seed、密度、粗细、抖动度、对称度、对比度与断裂度。模型自身的连续底毛材质会包住整个头部；其上只叠加一块从面部连续延伸到下巴的浅毛区，以及额头 M 纹、眼角线、双耳色块与耳根纹等固定猫科识别结构。密度控制正面、侧面和后脑的长曲纹数量；抖动度控制这些纹路的位置、长度、弧度、旋转与左右差异能偏离标准布局多少。算法选择与纹样布局分别跟随 Seed，因此选择固定算法后仍可让全局 Seed 改变纹路位置与弧度；每个参数都能独立跟随 Seed，手动修改后只会固化该参数。渲染器、组件与导出链路会从同一配置实时生成花纹；只有显式执行“转为可编辑贴花”时，才把结果物化到 `scene.decals`。

面部可以开启可配置的眼睛内高光。`scene.decals` 用于把矢量颜色形状投影到主体或指定实体部件表面；红晕、嘴部色块、徽标等细节会跟随同一套 3D 姿态与导出链路，而不是变成悬浮的独立几何体。需要在极端姿态下仍与五官基准面严格对齐的色块可使用 `face` 朝向；常规 `front`、`left`、`right`、`back` 朝向仍会贴合模型真实曲面。

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
        label: '左侧红晕',
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

应用可以传入多个动画库。库由 group 和 clip 组成，播放时也可以直接传 clip。`relative` 会把每个姿态维度各自第一次显式出现的值锚定到当前场景；`absolute` 使用动画中记录的绝对值。

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

v1 动画 patch 支持 `colorGrade`、`face`，以及 `view` 的 `pitch`、`yaw`、`positionX`、`positionY`。`roll`、`scale`、灯光和实体部件暂不属于 v1 动画 patch；校验器会拒绝未知或类型错误的字段。keyframe 必须位于 `0..durationMs`，每个实际时间段必须在 100–8000ms 内；这包括延迟首帧、相邻帧、Once 尾部停留和 Loop 回环。延迟首帧会从当前场景过渡，Once 动画会在末帧保持到完整 duration。

## React

`Avatar` 和 `AvatarEditor` 接收同一个 definition 和动画库。编辑器是在线产品使用的完整编辑器，不是简化表单。

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
    locale="zh-Hans"
    @definition-change="definition = $event"
  />
</template>
```

Vue 通过 `expose` 提供相同的渲染器与编辑器方法；事件使用 `animation-start`、`animation-end`、`definition-change` 等 emits。

手动旋转或移动交互会停止当前动画。`autoplay` 只会在 animation/autoplay 输入变化时启动，不会在手势更新 definition 后擅自重启。
