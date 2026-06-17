# RFC 0006：服务商与模型图标

返回 [RFC 0006](./0006-official-model-providers.md)。

## 目标

模型服务、官方服务商和模型都要有稳定图标，保证配置页、模型选择器、状态页和管理主页入口可以快速识别来源。

图标来源分三层：

- provider 内置图标：OpenAI、Claude、Kimi、DeepSeek、MiniMax、千问、智谱等。
- model service 覆盖图标：用户可在 `modelServices.<key>.icon` 上配置。
- model 覆盖图标：用户可在模型 metadata 上配置。

## 图标引用

建议使用统一引用类型：

```ts
type IconRef =
  | { kind: 'builtin'; id: string }
  | { kind: 'url'; url: string }
  | { kind: 'data'; value: string }
  | { kind: 'material'; name: string }
```

配置里可以先接受字符串简写：

- `builtin:openai`
- `builtin:moonshot`
- `material:api`
- `https://example.com/icon.svg`
- `data:image/svg+xml,...`

服务端归一化后再返回结构化 `IconRef` 给客户端。

## Provider 图标

`OfficialProviderDefinition` 必须包含默认图标：

```ts
interface OfficialProviderDefinition {
  icon: IconRef
}
```

内置 provider 图标至少覆盖：

- `openai`
- `anthropic`
- `moonshot-cn`
- `moonshot-intl`
- `deepseek`
- `minimax`
- `qwen`
- `zhipu`
- `azure`
- `gemini`
- `aws`
- `openrouter`
- `vercel`
- `requesty`
- `portkey`
- `litellm`
- `micu`
- `apiyi`
- `yunwu`
- generic `relay`
- generic `gateway`
- generic `model-service`

Moonshot/Kimi 中国站和国际站可以使用同一个视觉图标，但 tooltip 和 label 必须区分站点。

## Model Service 图标

`modelServices.<key>.icon` 是可选字段：

```yaml
modelServices:
  gateway:
    title: My Gateway
    icon: builtin:openai-compatible
    apiBaseUrl: https://gateway.example.com/v1
    apiKey: ${GATEWAY_API_KEY}
```

服务图标 fallback：

1. `modelServices.<key>.icon`
2. `modelServices.<key>.provider` 对应 provider icon
3. 用户从常见服务商图标 picker 中选择的 builtin icon
4. 默认固定图标，例如 `builtin:model-service`

没有 `provider` 的自定义服务仍然可以展示常见服务商图标选择器，例如 OpenAI-compatible、Azure OpenAI、OpenRouter、Ollama、LiteLLM、自建网关。

## Model 图标

模型 metadata 支持可选 `icon`：

```yaml
models:
  kimi-k2:
    title: Kimi K2
    icon: builtin:moonshot

modelServices:
  kimi-cn:
    provider: moonshot-cn
    apiKey: ${KIMI_CN_API_KEY}
```

模型图标 fallback：

1. `models.<modelId>.icon`
2. 远端模型 metadata 返回的 icon
3. 所属 `modelServices.<key>.icon`
4. 所属 provider icon
5. 默认固定模型图标，例如 `builtin:model`

模型选择器必须按具体 `service,model` 解析图标，因为同一个模型 ID 可能来自不同服务。

## UI

- 服务商下拉项展示 provider icon。
- 模型服务列表展示 service icon。
- 模型选择器展示 model icon；没有 model icon 时展示 service/provider icon。
- 模型服务选择器展示 service icon；没有 service icon 时展示 provider icon，再 fallback 到默认 service icon。
- 自定义服务表单提供图标选择器，默认选中 `builtin:model-service`。
- icon URL 预览失败时回退默认图标。

## 选择器契约

`listServiceModels` 或其后续替代实现需要返回已解析图标：

```ts
interface ServiceModelOption {
  value: string
  serviceKey: string
  modelId: string
  serviceIcon: IconRef
  modelIcon: IconRef
}
```

聊天模型选择器、配置页模型选择器和自动化启动模型选择器都使用同一份 option 数据，不能各自重新实现 fallback。

## 安全与格式

- 远程 icon URL 只允许 `https://`，开发模式可允许 localhost。
- 支持 SVG 但必须作为图片资源渲染，不 inline 执行脚本。
- 不从第三方页面自动抓 favicon 作为默认图标；只在用户明确粘贴 URL 或选择 builtin 时使用。
- data URL 要限制 mime type 和长度，避免把大文件写进配置。
