# RFC 0006：管理主页与内嵌打开

返回 [RFC 0006](./0006-official-model-providers.md)。

## 目标

每个官方服务商都可以提供一个默认管理主页。用户也可以在单个 `modelServices.<key>` 上覆盖主页，用于打开自建网关、企业代理、特定 region 控制台或 workspace 控制台。

模型服务详情页提供“一站式管理”入口：

- Electron 宿主使用内嵌 `webview` 打开管理主页。
- 浏览器宿主使用内嵌 `iframe` 打开管理主页。
- 如果平台禁止嵌入，降级为外部浏览器或新标签页打开。

## 注册表字段

服务商注册表新增 portal 链接：

```ts
interface ProviderPortalLinks {
  homeUrl: string
  apiKeysUrl?: string
  usageUrl?: string
  billingUrl?: string
  purchaseUrl?: string
  topUpUrl?: string
  pricingUrl?: string
  docsUrl?: string
}

interface OfficialProviderDefinition {
  portal: ProviderPortalLinks
}
```

`homeUrl` 是模型服务页面默认打开的后台管理主页。API key、usage、billing、purchase、top-up、pricing 等链接用于页内快捷入口。

## 配置覆盖

`modelServices.<key>.homepageUrl` 是可选覆盖项：

```yaml
modelServices:
  qwen-sg:
    title: 阿里千问新加坡
    provider: qwen
    apiKey: ${DASHSCOPE_INTL_API_KEY}
    homepageUrl: https://modelstudio.console.alibabacloud.com/?tab=api#/api-key
    providerOptions:
      region: ap-southeast-1
```

解析优先级：

1. `modelServices.<key>.homepageUrl`
2. provider registry 的 `portal.homeUrl`
3. 自定义服务没有主页时不显示内嵌入口，只显示“添加主页”

主页只用于 UI 导航，不参与模型调用、余额查询或 secret 管理 API。

## Electron 行为

Electron 版模型服务详情页使用 `webview`：

- 每个 service 使用稳定 partition，例如 `persist:model-provider:<serviceKey>`，方便保留登录态。
- URL 必须是 `https://`，localhost/dev 例外只允许在开发模式。
- 禁止 preload 注入业务脚本，不读取页面 DOM，不抓取控制台接口。
- 禁止从 webview 页面直接访问 One Works 主进程能力。
- 提供刷新、后退、前进、复制链接、外部浏览器打开、清除该服务登录态。

Electron 只把 webview 当作用户可操作的浏览器容器，不把它当 API client。

## 浏览器行为

Web 版模型服务详情页使用 `iframe`：

- iframe 地址同样来自 `homepageUrl` 或 provider registry。
- 使用最小权限 sandbox。需要登录弹窗或下载时，用户可切换到新标签页。
- 不尝试跨域读取 iframe 内容，也不把 iframe 登录态同步到 One Works。
- 如果 iframe 被 `frame-ancestors`、`X-Frame-Options`、登录跳转或第三方 Cookie 策略阻止，展示“在新标签页打开”。

浏览器模式不能保证所有平台都可内嵌。OpenAI、Anthropic、阿里云、智谱等平台随时可能禁止第三方 iframe；这是平台安全策略，不应绕过。

## UI 入口

模型服务详情页增加：

- “管理主页”主按钮。
- API Key、用量/账单、购买/充值、套餐/价格、文档快捷链接。
- “设置主页”字段，默认展示注册表 URL，保存后写入 `homepageUrl`。
- “恢复默认主页”动作，删除 `homepageUrl` 覆盖值。
- iframe/webview 加载失败态与外部打开 fallback。

服务商能力动作仍走后端 API。内嵌页面只用于用户登录、查看和手动管理。

## Agent 辅助流程

可以提供一份面向 agent 的自动化 runbook，让 agent 快速把用户带到对应页面并完成非敏感配置：

1. 打开服务商管理主页或购买/充值入口。
2. 等待用户自行登录、完成 MFA、验证码、实名或企业认证。
3. 导航到 API Key、余额、用量、套餐、资源包或充值页面。
4. 帮助用户填写非敏感配置项，例如 service 名称、region、workspace、模型 allowlist。
5. 在需要创建 key 时，引导用户点击官方按钮，并把用户主动复制出来的 key 写入 One Works secret 字段。
6. 到付款、充值、购买资源包、绑定银行卡、开票、实名确认前停止，提示用户亲自确认和提交。
7. 用户完成付款后，agent 可以继续查询余额、刷新模型列表、测试连接。

Provider 级 runbook 模板：

| 字段       | 内容                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| providerId | registry id，例如 `moonshot-cn`、`openrouter`、`micu`                                      |
| 入口       | homepage、apiKeys、billing、purchase、topUp、docs 中的一个                                 |
| agent 可做 | 打开页面、等待登录、导航到 API Key/充值/模型页、填写非敏感筛选字段、复制用户明确选中的 key |
| 必须停下   | MFA、实名、银行卡绑定、最终付款、购买资源包、开票、创建会产生费用的资源                    |
| 付款后继续 | 返回 One Works，刷新模型，查询余额/status，测试连接，必要时写回 `models`                   |

每个 preset 至少要有 homepage；有明确购买/充值入口时填 `billing` 或 `purchase/topUp`，没有时 runbook 只打开管理主页并提示用户手动选择。

边界：

- 不代输密码、MFA、验证码、支付信息、银行卡信息或实名资料。
- 不代点最终付款、购买、充值、开票或实名提交按钮。
- 不抓取网页 DOM 或未公开接口来提取 key、余额或套餐信息。
- 不在日志中记录 API key、支付页面内容或个人身份信息。
- 自动化步骤必须可中断，并在每个高风险动作前要求用户确认。

## 验证

- 官方 provider 缺省主页来自注册表。
- `homepageUrl` 覆盖值优先于注册表。
- Electron webview 使用独立 partition 并可清除登录态。
- 浏览器 iframe 被阻止时展示外部打开 fallback。
- iframe/webview 页面无法访问 One Works 内部 token、配置 API 或主进程能力。
- 不把 iframe/webview 页面内容写入日志或用于自动提取 API key。
- Agent runbook 在付款、实名、MFA 和支付信息输入前停止并等待用户。
