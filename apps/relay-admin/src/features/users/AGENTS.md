# Relay Admin Users Feature

`features/users` 负责 B 端用户管理：列表、创建、角色修改、禁用 / 启用，以及用户设备数量与连接上限配置。

## 入口

- `UserPanel.tsx`：用户模块装配，只组合表单和表格。
- `UserDetailPage.tsx`：`/admin/users/:userId` 的账号详情页，复用 dashboard snapshot 与用户操作 props。
- `UserTeamsPanel.tsx`：用户详情中的所属团队、团队角色、团队配置启停和继承 config profile 展示。
- `UserCreateForm.tsx`：创建用户表单。
- `UserTable.tsx`：用户列表、角色选择、设备数量 / 上限配置和状态操作。
- `userTableModel.ts`：用户列表搜索与角色 / 状态 / 来源 / 团队过滤纯逻辑。
- `userForm.ts`：从 `FormData` 生成 `CreateUserInput`，保持纯函数并配套测试。
- `usersApi.ts`：`/api/admin/users` 的 feature 专属 client。

## 约定

- 不在表格组件里写 fetch；用户操作通过 props 交给 dashboard hook。
- 表单字段归一化放在 `userForm.ts`，不要散在 JSX 事件里。
- 新增用户字段时同步更新 `shared/model/adminTypes.ts`、表格展示、表单解析和对应单测。
- 用户管理只能展示设备聚合字段，例如 `deviceCount` 与 `maxDevices`；其他用户的设备名称、支持功能、工作区和插件范围属于用户私有设备元数据，不要在用户管理页展示。面向用户的 UI 文案里 capabilities 叫「支持功能」，不要直接叫「能力」。
