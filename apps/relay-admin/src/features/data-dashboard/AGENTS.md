# Relay Admin Data Dashboard

本目录负责平台 owner/admin 的统一数据看板入口。稳定业务维度使用 `/data-dashboard/:dashboardTab` 路由表达：`overview` 汇总观测活跃、稳定性和 Model Service 核心指标，`stability` 复用隐私安全诊断页，`model-service` 复用平台 Model Service 分析页。

- `DataDashboardPage.tsx`：统一 tabs、path 路由和每个维度的 query 恢复。
- `DataDashboardOverview.tsx`：只组合既有诊断与 Model Service 安全聚合，不读取提示词、响应或原始日志。
- `dataDashboardApi.ts`：编排不同时间窗口的既有 Admin API。

“观测 DAU / WAU / MAU”只能表示已授权并成功上报的去重用户，不得省略“观测”口径或包装成完整平台活跃人数。平台诊断和模型事件的隐私边界继续分别由相邻 feature 与 Relay Server 负责。
