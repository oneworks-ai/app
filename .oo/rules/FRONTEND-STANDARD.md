---
alwaysApply: false
description: 仅在修改 apps/client 前端界面、路由、样式、主题或国际化时加载的前端规范。
globs:
  - apps/client/src/**/*
  - apps/client/__tests__/**/*
---

# 前端开发规范

本文件是前端约束入口页；具体约定拆到 `frontend-standard/`。

## 先看这些

- [模块组织](./frontend-standard/module-organization.md)
- [组件与数据](./frontend-standard/components.md)
- [样式与类名](./frontend-standard/styles.md)
- [主题与国际化](./frontend-standard/theme-i18n.md)
- [设计记忆与视觉审阅](./frontend-standard/design-memory.md)
- [调试与回归](./frontend-standard/debugging.md)

## 阅读要求

- 只要任务涉及交互、浮层、tooltip、popover、select、focus、theme、样式回归、热更新异常、真实 Chrome 验证或 CDP 调试，开始动手前必须先读 [调试与回归](./frontend-standard/debugging.md)。
- 只要任务涉及用户可见的布局、样式、主题、响应式、组件外观、视觉素材或参考图还原，开始动手前必须先读 [设计记忆与视觉审阅](./frontend-standard/design-memory.md)。任何用户可见视觉改动结束前必须完成独立视觉一致性审阅和经验分类；单点机械调整可以简化证据，但不能跳过审阅。
- 如果改动发生在 `apps/client/`，还应继续阅读 `apps/client/AGENTS.md`；如果范围进一步落到聊天页 / sender / 消息级交互，还要继续阅读 `apps/client/src/components/chat/AGENTS.md`。

## 核心约束

- 业务组件放在 `src/components/` 下。
- 路由统一使用 `react-router-dom`，不要手改 `window.location`。
- 静态样式不要写在 `style={{...}}` 里。
- 颜色、间距、圆角等全局设计 token 统一走 CSS 变量。
- UI 文本统一走 i18n，不在组件里硬编码中文。
- 浮层、tooltip、popover、select、focus 相关改动，必须补真实 Chrome 回归，不要只依赖静态检查。
- 用户给出设计反馈时必须区分当前画面的局部调整与可复用规范；明确的新规范持久化前先检查已有规则，冲突且作用域不清时必须询问用户是替换旧标准还是当前特例。
