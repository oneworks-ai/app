---
alwaysApply: true
description: 跨仓库通用代码风格入口；默认加载时只保留核心约束，详细规则见 coding-style/README.md。
---

# 代码风格入口

本文件会默认进入会话上下文，必须保持短小。完整说明见 [代码风格细则](./coding-style/README.md)。

## 核心约束

- import 分组顺序：样式 / 副作用、Node.js `node:`、第三方包、workspace 包、包内 `#~/`、相对路径；不同来源之间保留空行。
- `import type` 跟随来源归组，不因为是 type 就插到别的来源 group。
- 包内跨目录引用优先使用 `#~/`；同级或子级引用使用相对路径；跨 workspace 引用使用包名和对应 `exports`。
- 组件文件 / 目录和组件导出使用 PascalCase；工具函数、hooks、普通模块文件 / 目录使用 kebab-case。
- 模块私有实现放在模块目录下的 `@components`、`@core`、`@hooks`、`@types`、`@utils`、`@store`；只有跨模块复用时才提升到全局目录。
- 移动或重命名文件时使用 `mv`，并同步更新所有相关 import。

## 继续阅读

- 前端业务模块拆分：[`frontend-standard/module-organization.md`](./frontend-standard/module-organization.md)
- 完整代码风格细则：[`coding-style/README.md`](./coding-style/README.md)
