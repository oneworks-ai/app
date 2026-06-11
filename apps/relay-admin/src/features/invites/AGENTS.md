# Relay Admin Invites Feature

`features/invites` 负责 B 端邀请码管理：列表、创建、撤销 / 恢复和删除。

## 入口

- `InvitePanel.tsx`：邀请码模块装配，只组合表单和表格。
- `InviteCreateForm.tsx`：创建邀请码表单。
- `InviteTable.tsx`：邀请码列表和行级操作。
- `inviteForm.ts`：从 `FormData` 生成 `CreateInviteInput`，保持纯函数并配套测试。
- `invitesApi.ts`：`/api/admin/invites` 的 feature 专属 client。

## 约定

- 邀请码不能创建 `owner` 角色；可分配角色来自 `shared/model/adminRoles.ts`。
- 不在表格组件里写 fetch；邀请码操作通过 props 交给 dashboard hook。
- 新增邀请码字段时同步更新 `shared/model/adminTypes.ts`、表格展示、表单解析和对应单测。
