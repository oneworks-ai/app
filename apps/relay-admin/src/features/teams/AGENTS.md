# Relay Admin Teams Feature

`features/teams` 负责 Relay Admin 中的团队与团队配置方案管理界面。这里消费 `apps/relay-server` 的 `/api/admin/teams`、`/api/admin/team-policy`、`/api/admin/teams/:teamId/config-profiles`、`/api/admin/teams/:teamId/config-secrets`、`/api/admin/config-profiles/*`、`/api/admin/config-assignments/*` 和 `/api/admin/config-secrets/*`。

## 入口

- `teamsApi.ts`：团队、租户团队策略、配置方案 / 版本 / 分配的 Admin API 封装。
- `TeamPanel.tsx`：`/teams` 一级列表页，只负责团队列表和新建团队抽屉；不要在这里承载团队详情或站点策略。
- `TeamSettingsPage.tsx`：`/teams/settings` 二级配置页，负责站点团队策略表单；从 `/teams` 的 header 设置入口进入。
- `TeamDetailPage.tsx`：`/teams/:teamId/members|profiles|secrets` 二级详情子页，负责成员、配置方案和密钥 tabs；旧 `/teams/:teamId` 只做跳转。
- `TeamDetailSettingsPage.tsx`：`/teams/:teamId/settings` 三级团队配置页，负责团队名称、介绍、Slug 和团队级平台策略开关。
- `TeamMembers.tsx`：选中团队的成员列表、添加成员、角色调整和配置启停。
- `TeamPolicyForm.tsx`：站点管理员配置 teamsEnabled、selfService、proxyMode 和容量上限。
- `TeamTable.tsx`：团队列表、搜索、展示列、多选批量操作和团队归档 / 恢复状态操作。
- `TeamConfigProfiles.tsx`：选中团队的配置方案、版本发布和分配启停。
- `TeamConfigSecrets.tsx`：选中团队的密钥创建、轮换、撤销和脱敏 ID 列表。

## 约定

- 这个 feature 只做站点管理员视角；普通用户/团队管理员自助团队界面后续另建用户侧入口。
- 密钥只展示引用信息，不展示明文值；版本表单的 `secretRefs` 仅接收引用 ID。
- config patch 输入保持 JSON 结构化解析，提交前只把安全字段交给 server 继续过滤。
- 修改本 feature 后跑 `pnpm -C apps/relay-admin test`、`pnpm -C apps/relay-admin typecheck`，涉及打包入口时再跑 `pnpm -C apps/relay-admin build`。
