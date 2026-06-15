# Relay Admin Teams Feature

`features/teams` 负责 Relay Admin 中的团队与团队配置 profile 管理界面。这里消费 `apps/relay-server` 的 `/api/admin/teams`、`/api/admin/team-policy`、`/api/admin/teams/:teamId/config-profiles`、`/api/admin/teams/:teamId/config-secrets`、`/api/admin/config-profiles/*`、`/api/admin/config-assignments/*` 和 `/api/admin/config-secrets/*`。

## 入口

- `teamsApi.ts`：团队、租户团队策略、config profile / version / assignment 的 Admin API 封装。
- `TeamPanel.tsx`：团队配置页面的顶层编排，负责策略表单、团队列表和选中团队的配置 profile 区域。
- `TeamMembers.tsx`：选中团队的成员列表、添加成员、角色调整和配置启停。
- `TeamPolicyForm.tsx`：站点管理员配置 teamsEnabled、selfService、proxyMode 和容量上限。
- `TeamTable.tsx`：团队列表、搜索、展示列和选中团队操作。
- `TeamConfigProfiles.tsx`：选中团队的 config profile、version 发布和 assignment 启停。
- `TeamConfigSecrets.tsx`：选中团队的 secret 创建、轮换、撤销和 redacted ID 列表。

## 约定

- 这个 feature 只做站点管理员视角；普通用户/团队管理员自助团队界面后续另建用户侧入口。
- Secret 只展示引用信息，不展示明文值；版本表单的 `secretRefs` 仅接收引用 ID。
- config patch 输入保持 JSON 结构化解析，提交前只把安全字段交给 server 继续过滤。
- 修改本 feature 后跑 `pnpm -C apps/relay-admin test`、`pnpm -C apps/relay-admin typecheck`，涉及打包入口时再跑 `pnpm -C apps/relay-admin build`。
