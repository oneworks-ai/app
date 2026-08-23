# Avatar 原生 JavaScript 与 Web Component 接入

返回 [Avatar 总览](./avatar.md)，或阅读 [Definition、自定义动画、React 与 Vue](./avatar-runtime.md)。

## 原生 JavaScript

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

## Web Component

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

## 控制器、事件与捕获

React ref、Vue expose 和原生 mount 提供 `play`、`pause`、`resume`、`seek`、`stop`、`getDefinition`、`setDefinition` 与 `capture({ format, size, background, frame })`。`<oneworks-avatar>` 提供相同的播放和 capture 方法，但通过 `definition` DOM property 读写 definition，而不是 `getDefinition()` / `setDefinition()`。

编辑器的 React ref、Vue expose 和原生 mount 提供 `focus`、`getDefinition` 与 `setDefinition`；`<oneworks-avatar-editor>` 则使用 `focus()` 和 `definition` property。

事件按适配器使用各自的原生机制：React 使用 callback props；Vue 使用 emits；原生 mount host 与 Custom Element 派发 `avatarready`、`animationstart`、`animationloop`、`animationend`、`avatarerror`、`avatarchange`，编辑器对应 `editoready` 与 `avatarchange` DOM CustomEvent。

手动旋转或移动交互会停止当前动画。`autoplay` 只会在 animation/autoplay 输入变化时启动，不会在手势更新 definition 后擅自重启。

## 当前边界

- React、Vue、原生 JavaScript 与 Web Component 都使用在线编辑器的同一套几何 SVG 渲染链路，不会重画为 2D 替代品。
- 目前没有公开 iframe/embed URL 或 `postMessage` 协议。需要嵌入编辑能力时使用 `AvatarEditor`、`OneWorksAvatarEditor`、`createAvatarEditor` 或 `<oneworks-avatar-editor>`。
- 编辑器分享 URL 仍是不可拆解的 UI 持久化格式；不要手写或解析 `entityParts`、`animationData` 等 query 参数。
- `AvatarDefinition` 是应用运行时的数据源；编辑器 URL 是可继续编辑的来源；导出资源 URL 是可直接显示的静态或动画文件。这三者不要混用。
