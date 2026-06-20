# Relay Admin Profile Feature

`features/profile` 负责当前登录账号自己的 `/admin/profile` 页面。它是账号视角，不是后台用户管理视角。

## 入口

- `ProfilePage.tsx`：从左下角账号菜单进入的当前账号资料页。
- `profileApi.ts`：当前账号安全设置与 OpenAPI 调用审计 API client，调用 `/api/profile/*`；系统访问令牌明文只在生成响应后短暂展示一次。

## 约定

- 不在 profile 页暴露角色修改、禁用账号、重置他人密码等后台管理动作。
- profile 页主体使用 tabs 组织当前账号能力：账号信息、设备管理、账号安全、令牌管理、调用审计。tab label 必须按 Admin 风格使用图标 + 文案；不要在 tab 内容里重复放解释型标题 / 描述 / 计数块，tab label 和实际表格 / 操作已经提供上下文。
- profile 页 tabs 使用 `/admin/profile/:tab` 表达当前视图，tab key 固定为 `account`、`devices`、`security`、`tokens`、`audit`；可筛选列表的搜索、状态和时间范围应写入当前 tab 的 query，便于刷新、复制链接和前进后退恢复。
- 令牌管理和调用审计都是标准数据列表：搜索在 toolbar 左侧，刷新 / 生成 / 展示列是列表级 action；状态、时间范围等过滤必须放到对应 table header 的图标浮层里。令牌表默认过滤 active；时间列可排序并支持时间范围，状态 / Preview / 操作列不排序。
- 系统访问令牌、密码修改和 passkey 绑定都属于当前登录用户自己的安全操作；后端必须要求登录 session，不能让系统访问令牌继续生成或撤销其他访问令牌。
- 调用审计展示当前用户通过系统访问令牌访问 OpenAPI 的记录，数据来自 `/api/profile/openapi-audit`；页面仍按统一列表标准放搜索、筛选、列配置和底部分页。
- 2FA 在后端能力完整前只展示禁用态，不要在前端伪造成功流程。删除账号通过 `/api/profile/account` 执行当前账号自助删除，必须使用危险确认弹窗并要求输入账号 ID，不要做一键删除。
- profile 页 header 不放“登录其他账号”；账号切换入口属于左下角账号菜单。
- 后台用户详情继续放在 `features/users/UserDetailPage.tsx`，路由是 `/admin/users/:userId`。
