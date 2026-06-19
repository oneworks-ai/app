# RFC 0006：配置与服务端契约

返回 [RFC 0006](./0006-official-model-providers.md)。

## 配置扩展

在不破坏现有配置的前提下扩展 `ModelServiceConfig`：

```ts
interface ModelServiceConfig {
  title?: string
  description?: string
  icon?: string
  provider?: ModelProviderId
  homepageUrl?: string
  apiBaseUrl?: string
  apiKey: string
  models?: string[]
  timeoutMs?: number
  maxOutputTokens?: number
  providerOptions?: Record<string, unknown>
  management?: ModelServiceManagementConfig
  extra?: Record<string, unknown>
}
```

`icon` 是可选图标覆盖项；不配置时按 provider icon、常见服务商 icon、默认 service icon 的顺序 fallback。

`provider` 是可选字段，值来自 provider registry。registry 按 `category` 区分 `official`、`cloud`、`relay`、`gateway` 和 `custom`。自定义服务不存储 `custom` 字符串，而是通过缺省 `provider` 表示；需要模板化展示时可使用 `custom-openai-compatible` registry entry，但不强迫写入用户配置。

`homepageUrl` 是可选管理主页覆盖项，只用于 UI 打开服务商后台；默认主页来自服务商注册表。

`apiBaseUrl` 是可选覆盖项。配置了 `provider` 时，默认 base URL 来自服务商注册表；只有用户要覆盖区域、代理或私有网关时才写。未配置 `provider` 的自定义服务仍必须写 `apiBaseUrl`。

`models` 也是可选项。官方服务商省略 `models` 时，模型选择器使用服务商目录、远端查询结果或本地缓存。写入 `models` 表示用户要固定模型 allowlist。

## 管理配置

部分服务商动作需要不同于运行时模型 API key 的管理凭证：

```ts
interface ModelServiceManagementConfig {
  enabled?: boolean
  apiKey?: string
  organizationId?: string
  projectId?: string
  endpointKind?: string
}
```

规则：

- 对 Kimi 余额、DeepSeek 余额这类“模型 key 本身可调用管理端点”的服务商，默认复用 `apiKey`。
- OpenAI Admin API 动作必须要求 `management.apiKey`。
- v1 不支持用 DashScope 模型 API key 查询阿里云账号余额；阿里云账单需要 AccessKey 风格的另一套凭证。
- 配置 API 响应必须脱敏 `apiKey`、`management.apiKey` 和未来 secret 字段。
- 管理凭证默认优先写入 `user` 或 `global` 配置，不写入项目配置。

## 服务商识别

服务商识别是 best-effort 且非破坏性的：

```text
resolveOfficialProvider({
  configuredProvider,
  apiBaseUrl
}): {
  provider?: ModelProviderId
  confidence: 'configured' | 'host_match' | 'none'
  warnings?: string[]
}
```

Host 匹配只在用户提供 `apiBaseUrl` 时执行：

- `api.openai.com` -> `openai`
- `api.anthropic.com` -> `anthropic`
- `api.moonshot.cn` -> `moonshot-cn`
- `api.moonshot.ai` -> `moonshot-intl`
- `api.deepseek.com` -> `deepseek`
- `api.minimax.io` -> `minimax`
- `dashscope.aliyuncs.com`、`dashscope-us.aliyuncs.com`、`*.maas.aliyuncs.com` -> `qwen`
- `open.bigmodel.cn` -> `zhipu`

如果显式 `provider` 与 host 推断冲突，保留显式配置，但返回 warning。

## 归一化结果

远端模型结果归一化为：

```ts
interface ProviderModelInfo {
  id: string
  title?: string
  ownedBy?: string
  createdAt?: number
  contextLength?: number
  maxOutputTokens?: number
  supportsReasoning?: boolean
  inputModalities?: Array<'text' | 'image' | 'audio' | 'video' | 'file'>
  outputModalities?: Array<'text' | 'image' | 'audio' | 'video'>
  raw?: unknown
}
```

用户选择固定模型列表时，模型选择器只把 `id` 存进 `modelServices.<key>.models`。

更丰富的元信息可以在 API 响应中临时暴露。是否持久化必须是显式动作，并且不能在未确认时覆盖用户手写的 `models` 信息。

## Resolved Model Service

Adapter 消费解析后的 service，而不是直接消费 raw 配置：

```ts
interface ResolvedModelServiceConfig extends ModelServiceConfig {
  apiBaseUrl: string
  modelSource: 'configured' | 'provider_catalog' | 'remote_cache'
}
```

解析规则：

- 官方 `provider` 缺省 `apiBaseUrl` 时，使用注册表 `defaultApiBaseUrl`。
- 用户写了 `apiBaseUrl` 时，以用户覆盖值为准，并返回 override warning。
- 用户写了 `models` 时，选择器只展示这些模型。
- 用户未写 `models` 时，选择器展示 provider catalog 或最近一次远端查询缓存。
- 自定义服务没有 `apiBaseUrl` 时返回 `invalid_provider_config`。

## 服务端 API

新增服务端 service：`apps/server/src/services/model-providers/`。新增 route：`apps/server/src/routes/model-providers.ts`。

建议端点：

```text
GET  /api/model-providers
POST /api/model-providers/probe
GET  /api/model-providers/:providerId/status
POST /api/model-services/:serviceKey/models/list
POST /api/model-services/:serviceKey/models/refresh
POST /api/model-services/:serviceKey/balance
POST /api/model-services/:serviceKey/status
POST /api/model-services/:serviceKey/secrets
```

端点语义：

- `model-providers` 返回可安全给客户端使用的注册表元信息。
- `probe` 接收一个草稿 service 对象，返回识别出的 provider、能力和校验 warning。
- `models/list` 查询远端或静态目录模型，不写配置。
- `models/refresh` 把选中的模型 ID 按现有 config source 写回语义写入指定来源。
- `balance` 返回服务商原生余额、消费或 unsupported 结果。
- `status` 返回 provider 状态页/API 的归一化状态；失败不影响模型调用。
- `secrets` 只对支持的服务商创建或生成 secret，并且只返回一次 secret。

## 返回结构

余额与消费：

```ts
type ProviderAccountStatus =
  | { kind: 'balance'; currency?: string; available?: number; raw?: unknown }
  | {
    kind: 'cost'
    currency?: string
    amount?: number
    period?: string
    raw?: unknown
  }
  | { kind: 'unsupported'; reason: string }
```

secret 创建：

```ts
type ProviderSecretResult =
  | {
    kind: 'created'
    value: string
    id?: string
    expiresAt?: number
    raw?: unknown
  }
  | { kind: 'console'; url: string; reason: string }
  | { kind: 'unsupported'; reason: string }
```

## 写回边界

`models/refresh` 必须遵守现有 config source 规则：

- 读取目标 source 的原始 `modelServices`。
- 只 patch 被选中的 service entry。
- 保留 sibling services 和无关字段。
- 不把 `sources.merged` 或推断值写回 raw config。

## 错误处理

上游错误统一归一化为：`provider_unsupported`、`missing_api_key`、`missing_management_key`、`upstream_unauthorized`、`upstream_forbidden`、`upstream_rate_limited`、`upstream_unavailable`、`upstream_request_rejected`、`upstream_invalid_response`、`upstream_network_error`、`invalid_provider_config`。
错误消息和日志里不得包含 API key、bearer token 或完整请求头。
