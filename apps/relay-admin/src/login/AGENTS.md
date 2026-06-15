# Relay Login App

`src/login` 是 Relay `/login` 页面的 React + AntD 入口。这里负责最近账号、密码 / Passkey / 验证码登录方式、SSO provider 按钮和浏览器账号记忆逻辑。

## 入口

- `main.tsx`：读取 relay-server 注入的 `#relay-login-config`，挂载 AntD `ConfigProvider` 与 `RelayLoginApp`。
- `RelayLoginApp.tsx`：登录页面交互与 AntD 控件组合。
- `RelayLoginMethodSwitcher.tsx`：密码、Passkey、验证码等登录方式的切换入口。
- `RelayLoginApp.css`：登录页布局、玻璃面板和 AntD 控件 token 适配。
- `types.ts`：relay-server 注入配置与浏览器记忆账号类型。

## 约定

- 登录页控件优先使用 AntD，不在 relay-server 字符串模板里手写 input/button/list。
- relay-server 的 `/login` route 只负责校验 redirect、计算 provider start URL、注入 JSON config 和加载 `login.js`。
- Passkey UI 必须保持两阶段：第一屏只展示邮箱 / 账号名、记住账号和“使用 PASS KEY”；只有 `login/options` 返回 `passkey_unavailable` 且注册策略需要邮箱验证码或邀请码时，才在第二步展示这些字段。若新账号注册不需要验证码和邀请码，直接进入浏览器 passkey 创建流程；已有用户新增 passkey 仍由服务端要求邮箱验证。
- 新增或接入品牌 SSO provider 时，按同一流程补齐 `apps/relay-server/src/routes/login-page-client-config.ts` 的 provider icon 映射、`RelayLoginProviderConfig['icon']` 类型、`LoginProviderIcon.tsx` 品牌图标组件和登录 config 回归断言；不要让品牌 provider 退回默认 login 图标。
- 修改生产挂载时同步检查 `apps/relay-admin/vite.config.ts` 的 `login` entry 和 `apps/relay-server/src/routes/admin-ui.ts` 的 asset allowlist。通过 relay-server 直接服务 `/login` 的本地 demo 不走 HMR，改完登录页要先 `pnpm -C apps/relay-admin build`，再重启 relay-server。
