# Avatar 编辑器与开发者接入

OneWorks Avatar 是浏览器端 3D 几何头像编辑器，支持可继续编辑的分享链接，以及原生 SVG、PNG 和动画 GIF 导出。

在线编辑器：[oneworks.cloud/avatar](https://oneworks.cloud/avatar/)。

## 创建与导出

1. 从首页选择内置形象，或进入编辑器构建自己的几何形象。
2. 调整姿态、位置、缩放、面部、材质、光照、阴影、描边和动画。
3. 进入相机模式，选择画面尺寸、相框与背景。
4. 复制 SVG，或下载 SVG、PNG 和动画 GIF。

编辑器支持简体中文和英文，主题可跟随系统或手动切换明暗模式。

### 导出格式

| 格式 | 用途         | 说明                                             |
| ---- | ------------ | ------------------------------------------------ |
| SVG  | 静态矢量资源 | 保留当前 3D 场景的矢量投影、相机背景与相框裁切。 |
| PNG  | 静态位图资源 | 支持透明背景，适合应用头像、社交平台和设计稿。   |
| GIF  | 动画资源     | 导出当前选中的动画；未选择动画时不可用。         |

可选尺寸为 128、256 和 512 像素。相机背景可使用颜色或透明，相框可选方形、圆角或圆形。圆角和圆形相框外部保持透明。

## 保存可编辑源与应用资源

建议把可编辑源和应用实际使用的文件分开保存：

```ts
interface AvatarAssetRecord {
  editorUrl: string
  assetUrl: string
  format: 'svg' | 'png' | 'gif'
  size: 128 | 256 | 512
}
```

- `editorUrl` 是编辑器生成的完整分享链接。将它作为不可拆解的整体保存，以便日后重新打开和修改头像。
- `assetUrl` 指向上传到你的静态资源服务或媒体存储的导出文件。
- 编辑器链接不是图片直链，不能直接用于 `<img src>`。

导出的文件可以像普通图片一样接入：

```tsx
export function SupportAgentAvatar() {
  return (
    <img
      src='/avatars/support-agent.svg'
      width={96}
      height={96}
      alt='Support agent'
    />
  )
}
```

优先通过 `<img src>` 或独立图片文件接入，不要把多份导出 SVG 字符串直接注入同一个文档。内部 SVG definition ID 不是面向多份 inline SVG 的公开契约。

编辑器生成的分享链接应视为不透明状态。其 query tuple 是 UI 持久化格式，不是带版本的公开 API；不要手写或解析 `entityParts`、`animationData` 等内部参数。

## 当前 3D Runtime 边界

当前 3D 编辑器尚未提供公开的 React 组件、JavaScript/DOM renderer、带版本的 Avatar JSON definition、iframe/embed 模式或 `postMessage` 控制器。不要把编辑器内部模块当作 SDK 导入。

现阶段可用于产品接入的 3D 交付物是：

- 编辑器生成的完整分享链接，用作可继续编辑的源；
- 导出的 SVG 或 PNG，用作静态应用资源；
- 导出的 GIF，用作动画应用资源。

公开的 [`@oneworks/avatar`](https://github.com/oneworks-ai/app/blob/main/packages/avatar/README.zh-Hans.md) 是另一套 legacy 2D 像素表情 SVG renderer，适合生成确定性的应用占位头像；它不能读取或渲染 3D 编辑器场景。

## Agent Skill

Avatar 仓库包含 `oneworks-avatar` Agent Skill，用于创建、调试、导出和接入头像：

```bash
npx skills@latest add oneworks-ai/avatar
```

这个 Skill 使用真实编辑器及其 3D 场景模型，不会通过图像生成器重新绘制结果。它也会遵守当前 Runtime 边界，不会把私有编辑器模块描述成公开 SDK。

## 源码关系

Legacy 像素 renderer、glyph geometry、palette、preset 和 seed helper 位于 [`oneworks-ai/app`](https://github.com/oneworks-ai/app) 的 `packages/avatar`。3D 编辑器与导出链路位于 [`oneworks-ai/avatar`](https://github.com/oneworks-ai/avatar)。

Avatar 仓库作为 `assets/avatar` submodule 挂载回 app 仓库。它独立于 app 根 workspace 构建，并通过 `app-source` checkout 或软链接使用共享包源码。

## 本地开发

在 Avatar 仓库执行：

```bash
pnpm install --no-frozen-lockfile
ln -s /path/to/oneworks-app app-source
ONEWORKS_APP_SOURCE_DIR=app-source pnpm dev
ONEWORKS_APP_SOURCE_DIR=app-source pnpm build:app-source
```

## 部署

GitHub Pages 由 Avatar 仓库的 `deploy-avatar.yml` workflow 发布。app 仓库在以下 Avatar 输入发生变化时触发它：

- `assets/avatar`
- `assets/avatar/**`
- `packages/avatar/**`
- `.github/workflows/deploy-avatar.yml`

Pages build 会检出两个仓库，按指定 app source revision 构建并发布 `dist`。
