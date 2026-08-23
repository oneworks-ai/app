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

按接入目标继续阅读：

- [Definition、自定义动画、React 与 Vue](./avatar-runtime.md)
- [原生 JavaScript、Web Component、控制器与事件](./avatar-web.md)

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
