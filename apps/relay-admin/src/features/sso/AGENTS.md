# Relay Admin SSO Feature

`features/sso` 负责 B 端托管 SSO provider 元数据：列表、创建、启用 / 禁用、编辑端点与 client secret 轮换、删除。

## 入口

- `SsoProviderPanel.tsx`：组合创建表单、编辑表单和 provider 表格。
- `SsoProviderCreateForm.tsx` / `SsoProviderEditForm.tsx`：表单交互层，只负责提交和重置。
- `SsoProviderCallbackHint.tsx`：展示当前 provider 的 OAuth callback URL，供 Google / OIDC 控制台登记 redirect URI。
- `SsoProviderTable.tsx`：provider 列表、启用状态和行级操作。
- `ssoProviderPresets.ts`：SSO provider 预设配置；Google 端点、默认 scope 和 callback URL 拼接在这里集中维护。
- `ssoProviderForm.ts`：从 `FormData` 生成 create / update input，保持纯函数并配套测试。
- `ssoProvidersApi.ts`：`/api/admin/sso-providers` 的 feature 专属 client。

## 约定

- list/detail 响应里的 `clientSecret` 只能显示 redacted 值，不能假设能从 API 读回明文。
- 编辑 provider 时 secret 为空表示保留原 secret；只有填写新 secret 才提交更新。
- SSO 相关状态和 API 留在本 feature；dashboard 只做 snapshot 与操作编排。
- 新增常见 SSO 登录方式时优先加 preset，不要让用户手填标准端点；secret 仍由用户在管理端输入，不放进前端代码或文档示例。
