# Relay Login App

`src/login` 是 Relay `/login` 页面的 React + AntD 入口。这里负责最近账号、邀请码登录表单、SSO provider 按钮和浏览器账号记忆逻辑。

## 入口

- `main.tsx`：读取 relay-server 注入的 `#relay-login-config`，挂载 AntD `ConfigProvider` 与 `RelayLoginApp`。
- `RelayLoginApp.tsx`：登录页面交互与 AntD 控件组合。
- `RelayLoginApp.css`：登录页布局、玻璃面板和 AntD 控件 token 适配。
- `types.ts`：relay-server 注入配置与浏览器记忆账号类型。

## 约定

- 登录页控件优先使用 AntD，不在 relay-server 字符串模板里手写 input/button/list。
- relay-server 的 `/login` route 只负责校验 redirect、计算 provider start URL、注入 JSON config 和加载 `login.js`。
- 修改生产挂载时同步检查 `apps/relay-admin/vite.config.ts` 的 `login` entry 和 `apps/relay-server/src/routes/admin-ui.ts` 的 asset allowlist。
