---
rfc: 0006
title: 官方模型服务商能力
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-06-17
targetVersion: vNext
---

# RFC 0006：官方模型服务商能力

## 摘要

One Works 继续保留 `modelServices` 作为用户配置模型路由的入口，但在它上面增加一层“官方服务商”能力。一个服务仍然可以是任意自定义 OpenAI 兼容端点，也可以声明为 OpenAI、Claude、Kimi、DeepSeek、MiniMax、阿里千问或智谱 GLM 这类已知官方平台，也可以声明为服务商的 Coding Plan / Token Plan 编程套餐入口。

当配置的服务匹配到已知官方平台时，应用可以暴露服务商专属操作：

- 查询远端模型列表，并在用户选择固定模型时写回 `modelServices.<key>.models`；
- 在服务商返回时展示更丰富的模型元信息；
- 在官方 API 支持时查询余额、用量或消费；
- 只在官方公开 API 支持时创建或生成 secret；
- 对不支持 API 化的管理操作提供控制台深链；
- 直接打开服务商购买、充值、套餐或资源包页面，方便用户完成付款。

本 RFC 不实现代付或自动提交购买，不抓取未公开的控制台接口。浏览器自动化只用于受监督导航和配置辅助，敏感确认由用户完成。

## 目标

- 保留现有自定义 `modelServices` 行为和 `service,model` 选择器格式。
- 新增类型化官方服务商注册表，独立于各 adapter 的运行时代码。
- 通过显式 `provider` 配置或已知 hostname 识别官方服务商。
- 将 Moonshot/Kimi 中国站和国际站作为两个独立服务商处理。
- 阿里千问和智谱 GLM 只基于公开平台文档接入，不猜测私有管理 API。
- Coding Plan / Token Plan 使用独立 provider id，避免与普通 API key/base URL 混用。
- 提供管理主页、API Key、账单、购买/充值等官方页面入口。
- secret 只保存在服务端配置里，所有配置响应都必须脱敏。

## 非目标

- 不把 One Works 做成账单门户或支付处理系统。
- 不替用户完成付款、实名认证、发票申请或账号注册。可以打开对应页面并提供 agent 辅助流程，但最终付款和敏感确认必须由用户亲自完成。
- 不调用未文档化的网页控制台接口。
- 不要求每个官方服务商都支持每个 adapter。注册表描述的是 API 能力，adapter 兼容性仍由 adapter 自己决定。
- 不在用户确认前把远端发现的模型自动写入项目配置。

## 当前状态

`Config.modelServices` 目前是 `ModelServiceConfig` 的 map：

```ts
interface ModelServiceConfig {
  title?: string
  description?: string
  apiBaseUrl: string
  apiKey: string
  models?: string[]
  timeoutMs?: number
  maxOutputTokens?: number
  extra?: Record<string, unknown>
}
```

主要消费者：

- `packages/utils/src/model-selection.ts` 从静态 `models` 数组生成可选的 `service,model`。
- `apps/client/src/components/config/record-editors/ModelServicesRecordEditor.tsx` 编辑原始服务字段。
- `packages/adapters/codex/src/runtime/session-common.ts` 将 `modelServices` 转成 Codex provider override。
- `packages/adapters/claude-code/src/ccr/config.ts` 将 `modelServices` 转成 Claude Code Router provider。
- `packages/adapters/gemini/src/runtime/proxy.ts` 把 Gemini CLI 请求代理到 OpenAI 兼容 chat 端点。
- `packages/adapters/kimi/src/runtime/config.ts` 将 `modelServices` 映射到 Kimi CLI provider/model 配置。

现在缺的是一层服务商能力服务：现有代码知道如何调用已配置模型，但不知道如何发现模型、查询余额，或把官方平台限制明确暴露给用户。

## 方案结构

详细设计拆成九份短文档：

- [服务商注册表与能力矩阵](./0006-official-model-providers-capabilities.md)
- [modelServices 配置写法](./0006-official-model-providers-config-examples.md)
- [Coding Plan 与 Token Plan](./0006-official-model-providers-coding-plans.md)
- [执行流程与验收](./0006-official-model-providers-execution.md)
- [服务商与模型图标](./0006-official-model-providers-icons.md)
- [其他服务商场景](./0006-official-model-providers-scenarios.md)
- [管理主页与内嵌打开](./0006-official-model-providers-portal.md)
- [服务状态查询](./0006-official-model-providers-status.md)
- [配置、服务端 API 与归一化契约](./0006-official-model-providers-contracts.md)
- [UI、分阶段落地与验证计划](./0006-official-model-providers-ui-plan.md)

核心类型：

```ts
type ModelProviderId =
  | 'openai'
  | 'anthropic'
  | 'moonshot-cn'
  | 'moonshot-intl'
  | 'kimi-code'
  | 'deepseek'
  | 'minimax'
  | 'minimax-token-plan'
  | 'qwen'
  | 'qwen-coding-plan'
  | 'zhipu'
  | 'zhipu-coding-plan'
  | 'tencent-tokenhub-coding-plan'
  | 'volcengine-ark-coding-plan'
  | 'baidu-qianfan-coding-plan'
  | 'azure-openai'
  | 'google-gemini'
  | 'aws-bedrock'
  | 'openrouter'
  | 'vercel-ai-gateway'
  | 'requesty'
  | 'portkey'
  | 'litellm'
  | 'micu'
  | 'apiyi'
  | 'yunwu'
  | 'custom-openai-compatible'

interface OfficialProviderDefinition {
  id: ModelProviderId
  category: 'official' | 'cloud' | 'relay' | 'gateway' | 'custom'
  title: string
  icon: IconRef
  defaultApiBaseUrl?: string
  defaultWireApi: 'openai_chat' | 'openai_responses' | 'anthropic_messages'
  capabilities: ProviderCapabilities
  docs: ProviderDocsLinks
  portal: ProviderPortalLinks
  status?: ProviderStatusDefinition
}
```

`modelServices.<key>.provider` 指向注册表中的 provider。配置了 `provider` 后，默认 base URL、平台链接和模型目录都来自注册表；`apiBaseUrl` 和 `models` 只是可选覆盖项。未配置 `provider` 时，服务端可以根据 `apiBaseUrl` 推断；无法可靠推断时，该服务仍按自定义服务处理。

## 关键决策

- 官方服务商的最小配置是 `provider + apiKey`。自定义服务才必须写 `apiBaseUrl`。
- `modelServices.<key>.models` 是显式模型 allowlist；未配置时，模型选择器使用服务商目录、远端查询或缓存目录。
- 远端模型发现先返回归一化元信息；只有用户选择“固定模型列表”时才写回 `models`。
- 余额不是统一概念。返回结构必须区分 `balance`、`cost`、`usage` 和 `unsupported`。
- secret 创建是服务商专属能力。只有上游 API 返回明文 secret 时，UI 才展示一次性 secret 值。
- 阿里千问“临时 API Key”是短期委派 token，不是永久 API Key，应建模为 `generateTemporarySecret`，不是 `createSecret`。
- OpenAI project service account 创建返回项目 API key；OpenAI admin API key 创建返回 admin key。两者是独立动作。
- 智谱和千问的模型发现先使用静态目录或用户手填模型 ID，直到官方 API 索引公开稳定的 list models 端点。
- Coding Plan / Token Plan 的模型列表默认使用 provider registry 的静态目录，不假设 `/v1/models` 可用；只有用户明确固定 allowlist 时才写入 `modelServices.<key>.models`。
- OpenAI Codex 和 Anthropic Claude Code 的订阅额度属于产品登录权益；OpenAI/Anthropic API key 仍按普通 API 计费，不建模为 Coding Plan API key。

## 风险

- 服务商 API 和文档变化快，注册表需要测试覆盖和清晰文档链接。
- 官方 list models 端点可能漏掉可用 alias 或免费模型，UI 必须允许手动模型与发现模型共存。
- 余额端点的币种和语义不同，UI 应展示服务商原生值，不把它们伪装成可比较的统一余额。
- 管理凭证的风险高于普通模型 API key。默认只写入 user/global 配置，并在所有地方脱敏。

## 待定问题

- 更丰富的模型元信息应该持久化到顶层 `models`，还是只在服务端缓存？
- 管理凭证放在 `modelServices` 里，还是后续引入专门 secret store？
- 服务商操作应该先做 CLI、先做 UI，还是同一阶段一起做？
