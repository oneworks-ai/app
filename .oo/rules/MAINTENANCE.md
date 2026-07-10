---
alwaysApply: true
description: 仓库通用维护入口；默认加载时只保留快路径、上下文预算和排查索引。
---

# 项目维护入口

本文件会默认进入会话上下文，必须保持短小。完整维护说明见 [维护细则](./maintenance/README.md)。

## 开发服务 Fast Path

用户要求启动、拉取后启动或复用本地开发服务时，直接运行统一入口：

```bash
pnpm tools dev-start <target>
```

常用 target：`web`、`electron`、`electron-workspace`、`pwa`、`homepage`、`docs`。命令输出 `[dev-start] ready` 后不要再做额外 `ps`、`curl` 或读日志验证，除非命令失败或用户明确要求排查。

## 上下文预算

- `alwaysApply: true` 的规则正文会直接进入默认会话 prompt，只能写稳定硬约束和阅读路由；目标是控制在一屏内，避免把调试手册、命令大全或历史经验塞进默认上下文。
- 一级 `.oo/rules/*.md` 会进入规则目录。非 `alwaysApply` 规则通常只进摘要和路径，但仍会增加规则清单噪声；领域细节优先放进同名子目录，例如 `release/README.md`、`adapter-design/README.md`。
- 新增或扩写规则时，先判断内容是否需要默认加载。默认加载只保留“必须马上知道”的约束；任务相关细节用链接渐进式披露。
- 扩大 `.oo/rules` 内容后，至少跑一次体积审计，避免下次会话再次膨胀：

```bash
find .oo/rules -maxdepth 1 -type f -name '*.md' -print0 | xargs -0 wc -c -l
```

## 常见入口

- 代码质量、测试、发布前检查：[`maintenance/README.md`](./maintenance/README.md)
- 常见问题索引：[`maintenance/common-issues.md`](./maintenance/common-issues.md)
- 日志消费与排查：[`maintenance/logs.md`](./maintenance/logs.md)
- 开发任务的模型档位、速度、消耗与路由：[`maintenance/model-routing.md`](./maintenance/model-routing.md)
- 历史任务分布与六模型微基准报告：[`maintenance/model-routing-analysis.md`](./maintenance/model-routing-analysis.md)
- 任务规划、委派与经验沉淀：[`maintenance/task-planning.md`](./maintenance/task-planning.md)
- 能力展示录屏工具：[`maintenance/demo-video.md`](./maintenance/demo-video.md)
- 桌面打包 runtime cache：[`maintenance/desktop-packaged-runtime-cache.md`](./maintenance/desktop-packaged-runtime-cache.md)
