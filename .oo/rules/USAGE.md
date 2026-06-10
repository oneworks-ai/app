---
alwaysApply: false
description: 处理 README、面向用户文档、接入方式、安装运行说明或公开入口时读取。
---

# 使用文档边界

`.oo/rules` 是 `AGENTS.md` 的模块化组织目录，只承载规则、架构约束、实现边界、模块内部入口和 agent 稳定记忆。

`.oo/docs` 是 `README.md` 的模块化组织目录，只承载面向外部用户的安装、运行、CLI、插件和使用说明。

根目录的公开文档现在由 homepage docs 文档站承载：[https://oneworks-ai.github.io/docs/](https://oneworks-ai.github.io/docs/)。

## README 约定

- 根 README 只保留品牌、图标和必要路由入口。
- 不要在根 README 放内部排障、实现细节、迁移记录或产品截图。
- README 必须保持多语言支持：`README.md` 作为英文入口，`README.zh-Hans.md` 作为中文入口，并在顶部互链。
- 模块 README 如果面向外部用户，也应优先保留或补齐同等多语言入口。
- homepage docs 文档站承载根公开文档时，也必须保留 i18n 设计。

## AGENTS 约定

- `AGENTS.md` 只描述模块内部组织结构、内部入口信息和 agent 对这个模块的稳定记忆。
- `AGENTS.md` 不强制多语言，按模块内部协作效率选择中文、英文或混合表达。
- 当 `AGENTS.md` 单文件过大，或模块内部规则需要拆分时，把细节拆到最近的 `.oo/rules/` 下，并在最近的 `AGENTS.md` 保留入口链接。
