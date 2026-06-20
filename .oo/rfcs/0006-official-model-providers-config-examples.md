# RFC 0006：modelServices 配置写法

返回 [RFC 0006](./0006-official-model-providers.md)。

## 总体规则

调整后的 `modelServices` 仍然是一个 map。map key 是用户选择模型时的服务前缀，例如 `kimi-cn,kimi-k2` 里的 `kimi-cn`。

推荐规则：

- 官方平台写 `provider`，自定义兼容服务不写 `provider`。
- 官方平台默认不写 `apiBaseUrl`；默认 base URL 来自 `provider` 注册表。只有覆盖区域、代理或私有网关时才写。
- `apiKey` 是运行时模型调用 key。
- 官方平台默认不写 `models`；模型列表来自远端查询、静态目录或缓存。写了 `models` 就表示固定 allowlist。
- `providerOptions` 放区域、workspace、endpoint kind 这类非 secret 选项。
- `management` 只放管理动作需要的额外凭证，例如 OpenAI Admin API key。
- secret 字段写入 user/global 配置，项目配置里只保留非敏感结构。

## 官方平台示例

```yaml
modelServices:
  openai:
    title: OpenAI
    provider: openai
    apiKey: ${OPENAI_API_KEY}
    management:
      enabled: true
      apiKey: ${OPENAI_ADMIN_API_KEY}
      organizationId: org_xxx

  claude:
    title: Claude
    provider: anthropic
    apiKey: ${ANTHROPIC_API_KEY}

  kimi-cn:
    title: Kimi 中国站
    provider: moonshot-cn
    apiKey: ${KIMI_CN_API_KEY}

  kimi-intl:
    title: Kimi 国际站
    provider: moonshot-intl
    apiKey: ${KIMI_INTL_API_KEY}

  deepseek:
    title: DeepSeek
    provider: deepseek
    apiKey: ${DEEPSEEK_API_KEY}

  minimax:
    title: MiniMax
    provider: minimax
    apiKey: ${MINIMAX_API_KEY}
```

Kimi 中国站和国际站必须分开写两个 service。不要用一个 `moonshot` service 通过改 key 或 URL 在两边切换。

如果用户想固定某个平台只显示部分模型，再写 `models`：

```yaml
modelServices:
  kimi-cn:
    provider: moonshot-cn
    apiKey: ${KIMI_CN_API_KEY}
    models:
      - kimi-k2
```

## 千问与智谱示例

千问需要显式记录区域。UI 根据区域生成 `apiBaseUrl`，但用户可以覆盖最终 URL。

```yaml
modelServices:
  qwen-cn:
    title: 阿里千问 北京
    provider: qwen
    apiKey: ${DASHSCOPE_API_KEY}
    providerOptions:
      region: cn-beijing

  qwen-sg:
    title: 阿里千问 新加坡
    provider: qwen
    apiKey: ${DASHSCOPE_INTL_API_KEY}
    providerOptions:
      region: ap-southeast-1
      workspaceId: ws_xxx

  zhipu:
    title: 智谱 GLM
    provider: zhipu
    apiKey: ${ZHIPU_API_KEY}
    providerOptions:
      endpointKind: general
```

千问和智谱 v1 不依赖未文档化的 list models API。它们的 `models` 先来自静态目录、用户手填或后续文档同步脚本。

如果阿里某个账号必须使用 workspace 专属域名，可以覆盖默认 URL：

```yaml
modelServices:
  qwen-sg-workspace:
    title: 阿里千问新加坡 Workspace
    provider: qwen
    apiBaseUrl: https://ws_xxx.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
    apiKey: ${DASHSCOPE_INTL_API_KEY}
    providerOptions:
      region: ap-southeast-1
      workspaceId: ws_xxx
```

## Coding Plan / Token Plan 示例

Coding Plan / Token Plan 是服务商的计费套餐，不是 agent Plan Mode。套餐服务使用独立 provider id，避免把普通 API key/base URL 和套餐 key/base URL 混用。

详细 provider id、endpoint、区域覆盖和 YAML 示例见 [Coding Plan 与 Token Plan](./0006-official-model-providers-coding-plans.md)。

## 云资源型服务

Azure OpenAI、Vertex AI、Bedrock 这类不是简单 `provider + apiKey`。它们需要在 `providerOptions` 里记录资源、区域、部署或认证方式。

```yaml
modelServices:
  azure-prod:
    title: Azure OpenAI Prod
    provider: azure-openai
    apiKey: ${AZURE_OPENAI_API_KEY}
    providerOptions:
      endpoint: https://my-resource.openai.azure.com
      apiVersion: 2024-10-21
      deployment: gpt-4o-prod
      authMode: apiKey
```

这类 provider 的 `models` 默认应来自部署/模型发现；用户写 `models` 时表示固定 deployment allowlist。

## 国内中转平台

Micu、API易、云雾、DMXAPI、Atlas Cloud 这类平台按 relay preset 处理。默认提供图标、主页、base URL 和购买入口；余额、状态、key 管理等能力逐家确认。

```yaml
modelServices:
  micu:
    title: 米醋 API
    provider: micu
    apiKey: ${MICU_API_KEY}
```

如果平台要求分组、协议或特殊 header，用 `providerOptions` 或 adapter `extra` 表达。

海外 relay 同理：

```yaml
modelServices:
  requesty:
    title: Requesty
    provider: requesty
    apiKey: ${REQUESTY_API_KEY}
```

## 自定义兼容服务

自定义 OpenAI-compatible 服务继续沿用旧写法，不写 `provider`：

```yaml
modelServices:
  my-openai-compatible:
    title: My Gateway
    apiBaseUrl: https://gateway.example.com/v1
    apiKey: ${MY_GATEWAY_API_KEY}
    models:
      - my-fast-model
      - my-reasoning-model
    timeoutMs: 120000
    maxOutputTokens: 8192
    extra:
      codex:
        headers:
          X-Workspace: demo
      gemini:
        disableThinking: true
```

如果某个旧网关只接受完整 `chat/completions` endpoint，也可以继续保留：

```yaml
modelServices:
  legacy-chat:
    title: Legacy Chat Gateway
    apiBaseUrl: https://gateway.example.com/v1/chat/completions
    apiKey: ${LEGACY_GATEWAY_API_KEY}
    models:
      - legacy-model
```

官方 provider preset 新建的服务默认不写 `apiBaseUrl`；adapter 通过 resolved service 拿到注册表默认 URL，并在需要时转换为 `chat/completions`、`responses` 或原生 provider 配置。
