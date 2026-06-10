# Relay Admin Profile Feature

`features/profile` 负责当前登录账号自己的 `/admin/profile` 页面。它是账号视角，不是后台用户管理视角。

## 入口

- `ProfilePage.tsx`：从左下角账号菜单进入的当前账号资料页。

## 约定

- 不在 profile 页暴露角色修改、禁用账号、重置他人密码等后台管理动作。
- profile 页 header 不放“登录其他账号”；账号切换入口属于左下角账号菜单。
- 后台用户详情继续放在 `features/users/UserDetailPage.tsx`，路由是 `/admin/users/:userId`。
