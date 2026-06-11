# Relay Admin Shared Layer

`src/shared` 放跨 feature 复用的最小公共代码。不要把只属于单个业务域的逻辑提前抽到这里。

## 入口

- `api/requestJson.ts`：带 bearer token 的 JSON 请求 helper；Admin 页面传入的是当前登录 session token。
- `forms/readFormText.ts`：表单文本读取与 trim 小工具。
- `model/adminTypes.ts`：Relay admin API 使用的共享类型。
- `model/adminPermissions.ts`：管理端前端入口、route guard 和 snapshot 调用范围共用的权限判断。
- `model/adminRoles.ts`：角色常量和邀请码可分配角色。
- `ui/`：`DataPanel`、`StatusBadge` 等基础展示组件。

## 约定

- 只有两个以上 feature 需要的代码才放进 shared。
- `shared/api` 只放协议无关的基础请求工具；具体 endpoint client 留在 `features/<domain>/*Api.ts`。
- `shared/model` 的类型要与 `apps/relay-server` 的 admin API 响应保持一致；改字段时同步更新服务端测试和 admin 端测试。
