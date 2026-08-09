# Platform Model Usage

本目录负责平台 owner/admin 的跨团队 Model Service 用量分析。页面由统一数据看板的 `/data-dashboard/model-service` 装配，入口组件是 `PlatformModelUsage.tsx`，数据来自 `/api/admin/model-usage`；团队、成员、服务、来源和时间筛选必须保存在 URL，团队排行下钻到 `/teams/:teamId/usage`。

这里只展示 Relay 已归一化的身份、模型、计数和耗时事实，不得新增提示词、响应、tool I/O、路径或配置字段。团队 owner/admin 的自助视图继续维护在 `../teams/TeamModelUsage.tsx`，不要通过前端过滤模拟权限隔离。

验证入口：`pnpm -C apps/relay-admin test`、`pnpm -C apps/relay-admin build`，以及平台管理员和普通团队成员两种真实浏览器角色。
