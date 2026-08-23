# Avatar 编辑器与开发者接入

OneWorks Avatar 是浏览器端 3D 几何头像编辑器，也提供与在线编辑器共用同一套渲染器的开发者组件。你可以保存可继续编辑的源、导出 SVG/PNG/GIF，或在 React、Vue 和原生 JavaScript 应用中直接渲染与编辑版本化 Avatar definition。

在线编辑器：[oneworks.cloud/avatar](https://oneworks.cloud/avatar/)。

## 创建与导出

1. 从首页选择内置形象，或进入编辑器构建自己的几何形象。
2. 调整姿态、位置、缩放、面部、材质、光照、阴影、描边和动画。
3. 进入相机模式，选择画面尺寸、相框与背景。
4. 复制 SVG，或下载 SVG、PNG 和动画 GIF。

编辑器支持简体中文和英文，主题可跟随系统或手动切换明暗模式。

| 格式 | 用途         | 说明                                             |
| ---- | ------------ | ------------------------------------------------ |
| SVG  | 静态矢量资源 | 保留当前 3D 场景的矢量投影、相机背景与相框裁切。 |
| PNG  | 静态位图资源 | 支持透明背景，适合应用头像、社交平台和设计稿。   |
| GIF  | 动画资源     | 导出当前选中的动画；未选择动画时不可用。         |

可选尺寸为 128、256 和 512 像素。相机背景可使用颜色或透明，相框可选方形、圆角或圆形。圆角和圆形相框外部保持透明。

## 开发者接入

新的 3D Runtime 当前版本为 `0.1.0-alpha.0`，源码与 pack 后的干净 consumer 验证已公开在 [`oneworks-ai/avatar`](https://github.com/oneworks-ai/avatar)。四个新包尚未完成首次 npm registry 发布，因此现在不要执行同名包安装命令；以下 import 是已经实现并验证的公开 alpha 接口，而不是尚未落地的设计稿。

| 包                       | 用途                                                 |
| ------------------------ | ---------------------------------------------------- |
| `@oneworks/avatar-core`  | 版本化 definition、校验、序列化和动画运行时。        |
| `@oneworks/avatar-react` | React `Avatar` 渲染组件和完整 `AvatarEditor`。       |
| `@oneworks/avatar-vue`   | Vue `OneWorksAvatar` 和 `OneWorksAvatarEditor`。     |
| `@oneworks/avatar-web`   | 原生 JavaScript mount API 和显式注册 Web Component。 |

现有的 `@oneworks/avatar` 不在这张表里：它仍是独立的 legacy 2D 像素表情 SVG renderer，不能读取 3D definition。

### Definition 与自定义动画

`AvatarDefinition` 使用 schema `oneworks.avatar`，当前 definition version 为 `1`。场景包含实体部件、面部、姿态、相机、光照、材质效果和可选动画库；它是渲染器和编辑器之间的可携带数据源。

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

### React

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
    locale="zh-Hans"
    @definition-change="definition = $event"
  />
</template>
```

组件通过 `expose` 提供渲染器的 `play`、`pause`、`resume`、`seek`、`stop`、`capture`、`getDefinition`、`setDefinition`，以及编辑器的 `focus`、`getDefinition`、`setDefinition`。

### 原生 JavaScript

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
  locale: 'zh-Hans',
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

使用结束时调用 `destroy()`。渲染 mount 还提供 `update()`、`capture()` 和播放控制；编辑器 mount 提供 `update()`、`focus()`、`getDefinition()` 和 `setDefinition()`。

### Web Component

Web Component 不会在 import 时自动注册。应用必须显式调用一次注册函数，避免包在全局 `customElements` 上产生意外副作用。

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
<oneworks-avatar-editor locale="zh-Hans" theme="dark"></oneworks-avatar-editor>
```

复杂对象通过 DOM property 传递。属性只承载 `autoplay`、`interactive`、`theme` 和 `locale` 等简单值。两个元素断开再重新连接时会保留最后的 definition。

### 控制器、事件与捕获

React ref、Vue expose、原生 mount 和 `<oneworks-avatar>` 都提供相同的主要控制语义：

- `play`、`pause`、`resume`、`seek`、`stop`；
- `getDefinition`、`setDefinition`；
- `capture({ format, size, background, frame })`，返回 SVG 或 PNG `Blob`；
- `animationstart`、`animationloop`、`animationend`、`avatarerror`、`avatarchange` 等 DOM 事件；
- 编辑器额外提供 `focus`，并通过 `avatarchange` 交付完整 definition。

手动旋转或移动交互会停止当前动画。`autoplay` 只会在 animation/autoplay 输入变化时启动，不会在手势更新 definition 后擅自重启。

### 当前边界

- React、Vue、原生 JavaScript 与 Web Component 都使用在线编辑器的同一套几何 SVG 渲染链路，不会重画为 2D 替代品。
- 目前没有公开 iframe/embed URL 或 `postMessage` 协议。需要嵌入编辑能力时使用 `AvatarEditor`、`OneWorksAvatarEditor`、`createAvatarEditor` 或 `<oneworks-avatar-editor>`。
- 编辑器分享 URL 仍是不可拆解的 UI 持久化格式；不要手写或解析 `entityParts`、`animationData` 等 query 参数。
- `AvatarDefinition` 是应用运行时的数据源；编辑器 URL 是可继续编辑的来源；导出资源 URL 是可直接显示的静态或动画文件。这三者不要混用。

## 保存可编辑源与应用资源

即使应用使用 Runtime，也建议同时保存编辑源和部署资源：

```ts
interface AvatarAssetRecord {
  definition: AvatarDefinition
  editorUrl?: string
  assetUrl?: string
  format?: 'svg' | 'png' | 'gif'
}
```

- `definition` 用于 Runtime 渲染和程序化动画。
- `editorUrl` 是编辑器生成的完整分享链接；将它作为不可拆解的整体保存。
- `assetUrl` 指向上传到静态资源服务或媒体存储的导出文件。
- 编辑器链接不是图片直链，不能直接用于 `<img src>`。

## Agent Skill

Avatar 仓库包含 `oneworks-avatar` Agent Skill，用于创建、调试、导出和接入头像：

```bash
npx skills@latest add oneworks-ai/avatar
```

这个 Skill 使用真实编辑器及其 3D 场景模型，不会通过图像生成器重新绘制结果。

## 源码、本地开发与部署

Legacy 像素 renderer 位于 [`oneworks-ai/app`](https://github.com/oneworks-ai/app) 的 `packages/avatar`。3D 编辑器、Runtime、框架适配器和导出链路位于 [`oneworks-ai/avatar`](https://github.com/oneworks-ai/avatar)。

Avatar 仓库作为 `assets/avatar` submodule 挂载回 app 仓库。它独立于 app 根 workspace 构建，并通过 `app-source` checkout 或软链接使用共享包源码。

```bash
pnpm install --no-frozen-lockfile
ln -s /path/to/oneworks-app app-source
ONEWORKS_APP_SOURCE_DIR=app-source pnpm dev
ONEWORKS_APP_SOURCE_DIR=app-source pnpm test
ONEWORKS_APP_SOURCE_DIR=app-source pnpm typecheck:sdk
ONEWORKS_APP_SOURCE_DIR=app-source pnpm smoke:sdk
```

Avatar 页面由 Avatar 仓库的 `deploy-avatar.yml` workflow 发布。app 仓库在 `assets/avatar`、`assets/avatar/**`、`packages/avatar/**` 或 `.github/workflows/deploy-avatar.yml` 变化时触发它。文档页由主站 docs workflow 从 `.oo/docs` 发布。
