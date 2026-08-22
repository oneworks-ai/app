# @oneworks/avatar

[English](README.md) | [简体中文](README.zh-Hans.md)

`@oneworks/avatar` 是 OneWorks 的 legacy 2D 像素表情 SVG renderer，为应用占位头像提供确定性的、无 DOM 依赖的 SVG 与 data URI helper。

它不是 OneWorks 3D Avatar runtime。3D 编辑器、可编辑分享链接、SVG/PNG/GIF 导出和当前接入边界请参阅 [OneWorks Avatar](https://github.com/oneworks-ai/avatar/blob/main/README.zh-Hans.md)。

## 安装

```bash
pnpm add @oneworks/avatar
```

## React 用法

```tsx
import { useMemo } from 'react'
import { createSeededAvatarDataUri } from '@oneworks/avatar'

export function AgentAvatar({ id, name }: { id: string; name: string }) {
  const src = useMemo(() => createSeededAvatarDataUri({
    seed: `agent:${id}`,
    size: 128,
    title: `${name} avatar`
  }), [id, name])

  return <img src={src} width={64} height={64} alt={`${name} avatar`} />
}
```

## Node 或服务端 SVG

SVG helper 不依赖 DOM：

```ts
import { writeFile } from 'node:fs/promises'
import {
  createAvatarSvg,
  getAvatarPalette,
  isSupportedAvatarEmoticon
} from '@oneworks/avatar'

const emoticon = '0w0'
if (!isSupportedAvatarEmoticon(emoticon)) throw new Error('Unsupported avatar')

await writeFile('avatar.svg', createAvatarSvg({
  emoticon,
  palette: getAvatarPalette('signal'),
  backgroundStyle: 'gradient',
  showShadow: true,
  size: 256,
  title: 'Codex avatar'
}), 'utf8')
```

## 导出入口

- `@oneworks/avatar`：renderer、palette、glyph part、preset 和 seed helper。
- `@oneworks/avatar/avatar`：底层 SVG renderer 和像素 glyph 数据。
- `@oneworks/avatar/seed`：确定性的 seed-to-avatar helper。

除非确实需要窄子路径，否则优先从包根导入；不要 deep import `dist` 文件。

## 稳定性说明

- Seed 输出在同一包版本内保持确定性。如果 preset 集合或顺序发生变化，同一 seed 在后续版本可能得到不同结果。长期身份应固定包版本，或持久化已经解析出的 emoticon 和 palette ID。
- 本包渲染带背景的 legacy 像素头像，不提供透明 3D 输出、PNG/GIF 导出、相机相框、entity part 或动画。
- 调用 renderer 前，使用 `isSupportedAvatarEmoticon` 校验自定义表情。

## 维护入口

- `packages/avatar/src/avatar.ts`：glyph geometry、palette、preset 和 SVG 输出。
- `packages/avatar/src/seed.ts`：确定性 seed mapping。
- `assets/avatar` submodule：3D 编辑器和浏览器导出 UI。
