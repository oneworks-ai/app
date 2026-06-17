# RFC 0006：Coding Plan 与 Token Plan

返回 [RFC 0006](./0006-official-model-providers.md)。

## 定义

这里的 Coding Plan 指服务商的计费/额度/专属接入通道，不是 agent Plan Mode。

普通 API provider 和套餐 provider 使用不同的 `provider` id，避免混用 key/base URL。例如 `qwen` 是普通 DashScope API，`qwen-coding-plan` 是阿里云 Coding Plan；`zhipu` 是普通 BigModel API，`zhipu-coding-plan` 是 GLM Coding Plan。

OpenAI Codex 和 Anthropic Claude Code 的订阅额度属于产品登录权益。ChatGPT/Codex 登录或 `claude login` 可以使用订阅额度；OpenAI/Anthropic API key 仍按普通 API 计费，不建模为 Coding Plan API key。

## 配置字段

`modelServices.<key>.billing` 和 `modelServices.<key>.codingPlan` 是套餐元数据：

```ts
interface ModelServiceBillingConfig {
  kind?:
    | 'payg'
    | 'product_subscription'
    | 'coding_plan'
    | 'token_plan'
    | 'relay_coding_plan'
  keyKind?: 'payg_api_key' | 'coding_plan_key' | 'subscription_key'
  quotaUnit?: 'request' | 'token' | 'credit'
  quotaWindows?: Array<'5h' | 'weekly' | 'monthly'>
  allowedUse?: 'coding_tools_only' | 'general_api'
}

interface ModelProviderCodingPlanDefinition {
  supported: boolean
  official?: boolean
  planHomeUrl?: string
  keyHomeUrl?: string
  docsUrl?: string
  protocols?: {
    openai?: { baseUrl: string; docsUrl?: string }
    anthropic?: { baseUrl: string; docsUrl?: string }
  }
  regions?: Array<{
    id: string
    label: string
    protocols?: ModelProviderCodingPlanDefinition['protocols']
  }>
  defaultModels?: string[]
  restrictions?: string[]
}
```

## Provider Ids

| Provider                       | Key                                 | OpenAI-compatible                                 | Anthropic-compatible                                        |
| ------------------------------ | ----------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `qwen-coding-plan`             | Coding Plan key, commonly `sk-sp-*` | `https://coding.dashscope.aliyuncs.com/v1`        | `https://coding.dashscope.aliyuncs.com/apps/anthropic`      |
| `qwen-coding-plan` intl region | Coding Plan key                     | `https://coding-intl.dashscope.aliyuncs.com/v1`   | `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` |
| `zhipu-coding-plan`            | Coding Plan key                     | `https://open.bigmodel.cn/api/coding/paas/v4`     | `https://open.bigmodel.cn/api/anthropic`                    |
| `minimax-token-plan`           | Subscription Key                    | `https://api.minimax.io/v1`                       | `https://api.minimax.io/anthropic`                          |
| `kimi-code`                    | Kimi Code API key                   | `https://api.kimi.com/coding/v1`                  | `https://api.kimi.com/coding/`                              |
| `tencent-tokenhub-coding-plan` | Coding Plan API key                 | `https://api.lkeap.cloud.tencent.com/coding/v3`   | `https://api.lkeap.cloud.tencent.com/coding/anthropic`      |
| `volcengine-ark-coding-plan`   | Coding Plan API key                 | `https://ark.cn-beijing.volces.com/api/coding/v3` | `https://ark.cn-beijing.volces.com/api/coding`              |
| `baidu-qianfan-coding-plan`    | Coding Plan API key                 | `https://qianfan.baidubce.com/v2/coding`          | `https://qianfan.baidubce.com/anthropic/coding`             |

DeepSeek 当前按普通 PAYG API + coding-agent 集成处理，不是独立 Coding Plan provider。

## 配置示例

```yaml
modelServices:
  qwen-coding:
    provider: qwen-coding-plan
    apiKey: ${ALIYUN_CODING_PLAN_KEY}

  qwen-coding-intl:
    provider: qwen-coding-plan
    apiKey: ${ALIYUN_CODING_PLAN_KEY}
    codingPlan:
      region: intl

  zhipu-coding:
    provider: zhipu-coding-plan
    apiKey: ${ZHIPU_CODING_PLAN_KEY}

  minimax-token:
    provider: minimax-token-plan
    apiKey: ${MINIMAX_SUBSCRIPTION_KEY}

  kimi-code:
    provider: kimi-code
    apiKey: ${KIMI_CODE_API_KEY}
```

模型目录默认来自 provider registry，不依赖 `/v1/models`。只有用户明确固定 allowlist 时才写 `models`：

Kimi Code 是例外中的可用 API provider：模型可以从 `https://api.kimi.com/coding/v1/models` 查询，额度从
`https://api.kimi.com/coding/v1/usages` 查询。它仍然必须保持在 `kimi-code` provider 下，不能复用
Moonshot/Kimi Platform PAYG 的余额接口。

```yaml
modelServices:
  qwen-coding:
    provider: qwen-coding-plan
    apiKey: ${ALIYUN_CODING_PLAN_KEY}
    models:
      - qwen3-coder-plus
```

## 识别规则

Host/path 匹配按更具体的套餐 endpoint 优先：

- `api.kimi.com/coding/...` -> `kimi-code`
- `api.minimax.io/anthropic...` 或 `api.minimaxi.com/anthropic...` -> `minimax-token-plan`
- `coding.dashscope.aliyuncs.com`、`coding-intl.dashscope.aliyuncs.com` -> `qwen-coding-plan`
- `open.bigmodel.cn/api/coding/...` -> `zhipu-coding-plan`
- `api.lkeap.cloud.tencent.com/coding/...` -> `tencent-tokenhub-coding-plan`
- `ark.cn-beijing.volces.com/api/coding/...` -> `volcengine-ark-coding-plan`
- `qianfan.baidubce.com/*/coding...` -> `baidu-qianfan-coding-plan`

如果显式 `provider` 与 host 推断冲突，保留显式配置并返回 warning。

## 来源

- OpenAI Codex: [authentication](https://developers.openai.com/codex/auth), [ChatGPT plan usage](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan), [pricing](https://developers.openai.com/codex/pricing)
- Anthropic Claude Code: [Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
- 阿里云百炼: [Coding Plan](https://help.aliyun.com/zh/model-studio/coding-plan), [FAQ](https://help.aliyun.com/zh/model-studio/coding-plan-faq), [more tools](https://help.aliyun.com/zh/model-studio/more-tools)
- 智谱 GLM: [Coding Plan quick start](https://docs.bigmodel.cn/cn/coding-plan/quick-start), [other tools](https://docs.bigmodel.cn/cn/coding-plan/tool/others)
- MiniMax: [Token Plan quickstart](https://platform.minimax.io/docs/token-plan/quickstart), [Claude Code](https://platform.minimax.io/docs/token-plan/claude-code)
- Kimi Code: [overview](https://www.kimi.com/code/docs/en/), [FAQ](https://www.kimi.com/code/docs/en/kimi-code/faq.html), [third-party agents](https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html)
- 腾讯云 TokenHub: [Coding Plan](https://cloud.tencent.com/document/product/1823/130092)
- 火山方舟: [Coding Plan quickstart](https://www.volcengine.com/docs/82379/1928261)
- 百度千帆: [Coding Plan](https://cloud.baidu.com/doc/qianfan/s/imlg0beiu)
