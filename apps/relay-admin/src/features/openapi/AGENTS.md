# Relay Admin OpenAPI Feature

`features/openapi` 负责 `/admin/openapi` 页面，只展示 Relay Server 暴露的机器可读 OpenAPI 文档，不在前端重新声明 API 契约。

## 入口

- `OpenApiPage.tsx`：读取 `/api/profile/openapi.json` 与 `/api/admin/openapi.json`，按个人用户 API / 平台管理员 API 分开展示 endpoint、method、tag、鉴权和 operationId。
- `OpenApiPage.css`：OpenAPI 页面局部样式。

## 约定

- OpenAPI 契约来源只在 `apps/relay-server/src/routes/admin-openapi.ts`，这里不能复制 schema、paths 或 examples。
- 新增 OpenAPI 展示能力时优先扩展当前页面；如果引入 Swagger UI / Scalar 等 viewer，仍保留个人用户 API 与平台管理员 API 的视觉隔离。
- 个人用户 API 是所有登录账号都能查看的开发入口；平台管理员 API 可以展示，但必须标明需要管理员能力，不能在这里绕过后端权限。
