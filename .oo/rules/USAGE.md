---
alwaysApply: false
description: 处理 README、面向用户文档、接入方式、安装运行说明或公开入口时读取。
---

# 使用文档边界

`.oo/rules` 是 `AGENTS.md` 的模块化组织目录，只承载规则、架构约束、实现边界、模块内部入口和 agent 稳定记忆。

`.oo/docs` 是主仓公开文档内容源，只承载面向外部用户的安装、运行、CLI、插件、使用说明和文档图片 / 素材。它不是 VitePress 应用目录，不放 `package.json`、`.vitepress/`、Vue 组件、theme、构建脚本或部署配置，也不保留 README 占位说明。

根目录的公开文档由 homepage docs 文档站发布，canonical URL 是 [https://oneworks.cloud/docs/](https://oneworks.cloud/docs/)。主仓 `.oo/docs` 提供 Markdown 与图片内容，homepage / docs app 侧负责 VitePress 壳层、导航、构建和部署装配；这些壳层信息应沉淀在 homepage 侧的 `AGENTS.md` 或规则文档中，而不是写进 `.oo/docs` README。

## `.oo/docs` 约定

- 中文 root locale 放在 `.oo/docs/index.md` 与 `.oo/docs/usage/`。
- 英文 locale 放在 `.oo/docs/en/index.md` 与 `.oo/docs/en/usage/`。
- 跨语言共用图片优先放在 `.oo/docs/images/`，带语言差异的截图或标注放在对应 locale 页面附近。
- 页面之间使用能被 VitePress shell 消费的相对链接；不要引用旧 homepage docs app 目录作为内容源路径。

## README 约定

- 根 README 只保留品牌、图标和必要路由入口。
- 不要在根 README 放内部排障、实现细节、迁移记录或产品截图。
- README 必须保持多语言支持：`README.md` 作为英文入口，`README.zh-Hans.md` 作为中文入口，并在顶部互链。
- 模块 README 如果面向外部用户，也应优先保留或补齐同等多语言入口。
- `.oo/docs` 承载根公开文档内容源时，也必须保留 i18n 设计。

## AGENTS 约定

- `AGENTS.md` 只描述模块内部组织结构、内部入口信息和 agent 对这个模块的稳定记忆。
- `AGENTS.md` 不强制多语言，按模块内部协作效率选择中文、英文或混合表达。
- 当 `AGENTS.md` 单文件过大，或模块内部规则需要拆分时，把细节拆到最近的 `.oo/rules/` 下，并在最近的 `AGENTS.md` 保留入口链接。
