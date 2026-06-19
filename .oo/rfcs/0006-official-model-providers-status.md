# RFC 0006：服务状态查询

返回 [RFC 0006](./0006-official-model-providers.md)。

## 目标

官方服务商可以提供状态页和可选状态 API。One Works 在模型服务详情页展示服务状态，但这个状态只作为诊断信息，不作为模型调用前置条件。

状态能力分三类：

- `statuspage`：公开 Statuspage JSON，可直接查询。
- `cloud_status_openapi`：云厂商服务健康 OpenAPI，需要云账号凭证。
- `page_only`：只有公开状态页，未确认公开 JSON API。
- `unsupported`：未找到官方状态页或状态 API。

## 注册表字段

```ts
interface ProviderStatusDefinition {
  kind: 'statuspage' | 'cloud_status_openapi' | 'page_only' | 'unsupported'
  pageUrl?: string
  summaryUrl?: string
  statusUrl?: string
  componentMatchers?: string[]
  requiresCredentials?: boolean
  notes?: string
}

interface OfficialProviderDefinition {
  status?: ProviderStatusDefinition
}
```

`componentMatchers` 用于从总状态里筛出 API 相关组件，例如 `Claude API (api.anthropic.com)` 或 `Open API`。

## 平台矩阵

| 服务商             | 状态页                                                           | 可机器查询 API                                                          | 备注                                                                                     |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| OpenAI             | `https://status.openai.com/`                                     | `https://status.openai.com/api/v2/summary.json`、`/api/v2/status.json`  | Statuspage JSON；状态是聚合值，不代表单个模型或单个账号                                  |
| Claude / Anthropic | `https://status.claude.com/`                                     | `https://status.claude.com/api/v2/summary.json`、`/api/v2/status.json`  | Statuspage JSON；组件包含 `Claude API (api.anthropic.com)`                               |
| Kimi / Moonshot    | `https://status.moonshot.cn/`                                    | `https://status.moonshot.cn/api/v2/summary.json`、`/api/v2/status.json` | Statuspage JSON；组件包含 `Open API`；中外站先共用该状态页，直到官方提供独立国际站状态页 |
| MiniMax            | `https://status.minimax.io/`                                     | `https://status.minimax.io/api/v2/summary.json`、`/api/v2/status.json`  | Statuspage JSON；组件包含 `Large Language Models (LLM)`                                  |
| DeepSeek           | `https://status.deepseek.com/`                                   | 未确认公开 JSON API                                                     | 只展示状态页和链接，不抓页面内容                                                         |
| 阿里千问           | `https://status.aliyun.com/`、`https://status.alibabacloud.com/` | 阿里云健康看板 OpenAPI `Status`                                         | 需要阿里云 AccessKey/RAM 权限，不是 DashScope 模型 API key                               |
| 智谱 GLM           | 未找到官方状态页                                                 | 未找到公开状态 API                                                      | 展示“不支持官方状态查询”，保留手动测试连接                                               |

## Relay / Gateway 状态

首版 relay/gateway preset 只展示已确认状态入口，不调用未确认 API：

| Provider ID                | 状态入口                         | v1 行为                                           |
| -------------------------- | -------------------------------- | ------------------------------------------------- |
| `openrouter`               | `https://status.openrouter.ai/`  | `page_only` 或后续确认 Statuspage JSON 后启用 API |
| `vercel-ai-gateway`        | `https://www.vercel-status.com/` | `page_only`，不把整站状态等同单 gateway           |
| `requesty`                 | 未确认公开状态页                 | `unsupported`，提供测试连接                       |
| `portkey`                  | 未确认公开状态页                 | `unsupported`，提供测试连接                       |
| `litellm`                  | 自托管实例自定义                 | `manual` / `unsupported`，允许用户覆盖主页        |
| `micu` / `apiyi` / `yunwu` | 未确认公开状态 API               | `page_only` 或 `unsupported`，只打开管理页        |

## 服务端 API

建议新增：

```text
GET  /api/model-providers/:providerId/status
POST /api/model-services/:serviceKey/status
```

返回结构：

```ts
type ProviderStatusIndicator =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance'
  | 'unknown'
  | 'unsupported'

interface ProviderServiceStatus {
  indicator: ProviderStatusIndicator
  description?: string
  pageUrl?: string
  checkedAt: string
  components?: Array<{ name: string; status: string }>
  incidents?: Array<{ name: string; status?: string; impact?: string }>
  source: 'statuspage' | 'cloud_status_openapi' | 'page_only' | 'unsupported'
}
```

规则：

- Public Statuspage JSON 不需要模型 API key。
- 状态查询结果缓存 60 到 120 秒，避免配置页频繁请求第三方状态页。
- 状态查询超时不影响模型调用，只显示 `unknown`。
- 阿里云 Health Status OpenAPI 需要独立云账号凭证，不能复用 DashScope API key。
- 不通过 iframe/webview 抓取页面状态，不解析未公开网页接口。

## UI

模型服务详情页增加状态区域：

- 状态徽标：正常、降级、部分故障、严重故障、维护、未知、不支持。
- “刷新状态”按钮。
- “打开状态页”链接。
- 对 `page_only` 展示“官方只提供状态页，未确认可查询 API”。
- 对 `unsupported` 展示“未找到官方状态页/状态 API，可使用测试连接确认当前 key 与网络是否可用”。

状态页也可以在管理主页区域打开，但状态 API 查询走服务端，避免客户端直接跨域请求第三方 JSON。

## 验证

- Statuspage summary JSON 正确映射 page status、components、incidents。
- 组件 matcher 能筛出 API 相关组件。
- DeepSeek `page_only` 不尝试调用未确认 API。
- 阿里云状态 OpenAPI 缺少云账号凭证时返回结构化 `unsupported` 或 `missing_management_key`。
- 状态接口失败或超时时不阻塞配置页和模型调用。
