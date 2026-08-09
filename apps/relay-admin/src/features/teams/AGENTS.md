# Relay Admin Teams Feature

`features/teams` 负责 Relay Admin 中的平台团队管理、团队自助视图、团队配置方案与 Model Service 用量分析界面。平台 owner/admin 使用 `/api/admin/teams*`；普通团队 owner/admin 从 `/api/relay/teams*` 加载自己的团队，并通过 `/api/relay/teams/:teamId/model-usage` 查看内容无关的团队用量。配置 profile / secret / documents 等平台管理页面继续使用对应 `/api/admin/*` 接口。

## 入口

- `teamsApi.ts`：团队、租户团队策略、配置方案 / 版本 / 分配的 Admin API 封装。
- `TeamPanel.tsx`：`/teams` 一级列表页，只负责团队列表和新建团队抽屉；不要在这里承载团队详情或站点策略。
- `TeamSettingsPage.tsx`：`/teams/settings` 二级配置页，负责站点团队策略表单；从 `/teams` 的 header 设置入口进入。
- `TeamDetailPage.tsx`：`/teams/:teamId/members|usage|profiles|secrets|documents|audit` 二级详情子页，负责成员、模型用量、配置方案、密钥、同步文档和操作审计 tabs；旧 `/teams/:teamId` 只做跳转。
- `TeamModelUsage.tsx` / `teamModelUsageApi.ts`：团队模型用量摘要、趋势、服务分布、成员排行、事件下钻与安全导出；筛选条件必须走 URL query。
- `TeamDetailSettingsPage.tsx`：`/teams/:teamId/settings` 三级团队配置页，负责团队名称、头像、介绍、Slug、团队模型用量上报模式和团队级平台策略开关。
- `TeamMembers.tsx`：选中团队的成员列表、添加成员、角色调整和配置启停。
- `TeamPolicyForm.tsx`：站点管理员配置 teamsEnabled、selfService、proxyMode 和容量上限。
- `TeamTable.tsx`：团队列表、搜索、展示列、多选批量操作和团队归档 / 恢复状态操作。
- `TeamConfigProfiles.tsx`：选中团队的配置方案、版本发布和分配启停。
- `TeamConfigSecrets.tsx`：选中团队的密钥创建、轮换、撤销和脱敏 ID 列表。
- `TeamDocuments.tsx`：选中团队的同步文档密文快照统计，只展示数量、大小、更新时间和 hash，不展示明文内容。
- `TeamAuditEvents.tsx`：选中团队的操作审计列表，仅展示审计 metadata。

## 约定

- 团队详情承载站点管理员视角，并且是当前用户查看该团队上报策略与成员偏好的唯一控制面；不要把多个团队的策略重新平铺到 profile 模型用量页。
- 密钥只展示引用信息，不展示明文值；版本表单的 `secretRefs` 仅接收引用 ID。
- config patch 输入保持 JSON 结构化解析，提交前只把安全字段交给 server 继续过滤。
- 修改本 feature 后跑 `pnpm -C apps/relay-admin test`、`pnpm -C apps/relay-admin typecheck`，涉及打包入口时再跑 `pnpm -C apps/relay-admin build`。
