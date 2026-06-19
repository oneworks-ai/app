# RFC 0006：其他服务商场景

返回 [RFC 0006](./0006-official-model-providers.md)。

## 分层

不要把所有模型商都放进首批 provider enum。按接入形态分层：

- 直连官方 API：一个平台账号、一个 API key、一个默认 base URL。
- 云资源型 provider：需要 cloud subscription/project、region、resource、deployment 或 IAM。
- OpenAI-compatible 聚合网关：一个兼容 base URL，额外提供模型、余额、key 管理 API。
- 中国云厂商兼容接口：常兼容 OpenAI，但计费、实名、资源包和控制台入口差异大。
- 国内中转/编程套餐平台：通常聚合 Claude、OpenAI、Gemini、DeepSeek 等，面向 Claude Code、Codex、Cline 等工具。
- 自建或本地网关：由用户维护，不承诺官方管理能力。

第一版不要求所有平台都有深度 API 能力，但常见场景都要有轻量接入 preset。轻量 preset 至少包含 title、icon、homepage、购买/充值/配置入口、base URL 生成规则和空能力声明。

## 云资源型

| 场景                             | 候选 provider id                | 配置特点                                                 | 能力建议                                                 |
| -------------------------------- | ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Azure OpenAI / Microsoft Foundry | `azure-openai`、`azure-foundry` | 需要 endpoint/resource、deployment、apiVersion、authMode | 支持模型/部署发现；余额走 Azure billing，不复用模型 key  |
| Google Gemini API                | `google-gemini`                 | AI Studio API key；OpenAI-compatible base URL 可固定     | 可作为二期直连 provider                                  |
| Google Vertex AI                 | `google-vertex`                 | 需要 project、location、OAuth/ADC/service account        | 先做云 provider，不按简单 API key 处理                   |
| AWS Bedrock                      | `aws-bedrock`                   | 需要 region、SigV4、AWS credentials、modelId             | 通过 `ListFoundationModels` 发现模型；账单走 AWS Billing |

Azure 的关键点：模型调用常用 deployment name，不一定等于基础模型 ID。`models` 可以表示 deployment allowlist；providerOptions 需要 `resourceName`、`deployment`、`apiVersion`、`authMode`。

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

## 聚合与推理平台

| 平台         | 候选 provider id | 接入形态                                           | 管理能力                                      |
| ------------ | ---------------- | -------------------------------------------------- | --------------------------------------------- |
| Groq         | `groq`           | OpenAI-compatible `https://api.groq.com/openai/v1` | 模型列表公开；账单/余额以控制台为主           |
| Fireworks AI | `fireworks`      | OpenAI/Anthropic-compatible，另有管理 API          | 模型列表、API key、usage/cost 可做二期        |
| Together AI  | `together`       | OpenAI-compatible serverless model API             | 模型目录和 prepaid credits；余额 API 需再确认 |
| Mistral AI   | `mistral`        | 官方 API；部分 OpenAI-compatible 场景              | 模型列表公开；账单多走 Studio                 |
| xAI          | `xai`            | 官方 Grok API                                      | 模型目录公开；账单/credits 以控制台为主       |
| SiliconFlow  | `siliconflow`    | OpenAI-compatible 聚合平台                         | 国内常用，模型和余额能力需按官方文档核实      |

这类平台适合做 provider preset，因为它们通常仍是 `apiKey + baseURL`。但余额、key 管理和状态能力不能按 OpenAI 推断，必须逐个注册。OpenRouter 这类模型聚合中转放在下一节。

第一版可先留空管理能力，只提供图标、主页、配置入口、购买入口和手动模型 allowlist。

## 海外中转与 AI Gateway

海外中转站可分成两类：平台代计费的聚合 API，以及企业自带 key 的 AI Gateway。两者都能做 preset，但管理能力边界不同。

| 平台                  | 候选 provider id     | 接入形态                                          | 管理能力                                                                     |
| --------------------- | -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| OpenRouter            | `openrouter`         | OpenAI-compatible `https://openrouter.ai/api/v1`  | OpenAPI、模型列表、credits API、OAuth/API key 管理较完整                     |
| Vercel AI Gateway     | `vercel-ai-gateway`  | Vercel team 级统一网关                            | 模型/价格发现、Vercel credits、observability；适合 Vercel 用户               |
| Requesty              | `requesty`           | OpenAI-compatible `https://router.requesty.ai/v1` | 400+ 模型、路由、限额、fallback、团队策略                                    |
| AIMLAPI               | `relay-aimlapi`      | OpenAI-compatible `https://api.aimlapi.com/v1`    | 500+ 模型；公开 model list API；账单能力需确认                               |
| Eden AI               | `relay-edenai`       | 统一 AI API / smart routing                       | 覆盖多模态和多供应商；协议不一定完全等同 OpenAI-compatible                   |
| Portkey               | `portkey`            | 企业 AI gateway / virtual keys                    | BYOK、virtual keys、预算、限流、审计，不应视作代计费中转                     |
| LiteLLM Cloud/Proxy   | `litellm`            | 自托管或托管 AI gateway                           | virtual keys、spend tracking、budgets、admin UI                              |
| Helicone AI Gateway   | `gateway-helicone`   | OpenAI-compatible gateway + observability         | 路由、fallback、缓存、日志观测；通常是 BYOK 控制面                           |
| Cloudflare AI Gateway | `gateway-cloudflare` | Cloudflare account/gateway 级统一入口             | 需要 accountId/gatewayId；支持 OpenAI-compatible endpoint 和 unified billing |

海外 relay preset 规则：

- 第一版必须能选中 preset，并引导用户打开官网完成注册、充值/购买、创建 key 和复制 key。
- `category: relay` 默认可以提供 base URL、模型发现、credits/usage、购买入口；但必须逐家确认。
- `category: gateway` 默认是企业网关或 BYOK 控制面，只承诺路由、观测、key 管理入口，不承诺平台代计费余额。
- Vercel、Cloudflare 这类需要 team/account/gateway id，配置不能简化成单一 `apiKey`。
- OpenRouter、Requesty、AIMLAPI 更接近国内 relay preset，可以先做最小 `provider + apiKey`。
- DeepInfra、Novita、Together、Groq、Fireworks 更像推理平台，不是严格中转站；它们仍可做 provider preset。

## 中国云厂商

| 平台                  | 候选 provider id  | 接入形态                                                     | 备注                                      |
| --------------------- | ----------------- | ------------------------------------------------------------ | ----------------------------------------- |
| 百度千帆 ModelBuilder | `baidu-qianfan`   | OpenAI-compatible `https://qianfan.baidubce.com/v2`          | 可作为国内二期 provider                   |
| 腾讯混元              | `tencent-hunyuan` | OpenAI-compatible `https://api.hunyuan.cloud.tencent.com/v1` | API key 控制台创建；计费看腾讯云控制台    |
| 火山方舟 Ark          | `volcengine-ark`  | OpenAI-compatible `https://ark.cn-beijing.volces.com/api/v3` | 模型可能是 endpoint/model id；需要 region |
| 讯飞星火              | `iflytek-spark`   | 官方 API，兼容性需核实                                       | 放入待调研                                |
| 商汤日日新            | `sensenova`       | 官方平台 API，兼容性需核实                                   | 放入待调研                                |
| 百川智能              | `baichuan`        | 官方 API，兼容性需核实                                       | 放入待调研                                |

中国云厂商通常涉及实名、资源包、企业账号、区域和控制台购买流程。One Works 只打开页面和提供 agent runbook，不代替购买或实名确认。

第一版可先提供 homepage、购买/资源包、API key、文档入口和 region/base URL 模板；模型查询、余额和状态 API 可标记为 `unsupported` 或 `todo`。

## 国内中转与编程套餐平台

这类平台不是底层模型官方 provider，而是 relay / reseller / aggregation preset。它们适合提供图标、主页、base URL、模型分组和购买入口，但不要默认继承 OpenAI、Anthropic 或 Gemini 的官方管理能力。

| 平台                                     | 候选 provider id   | 接入形态                   | 备注                                                                                  |
| ---------------------------------------- | ------------------ | -------------------------- | ------------------------------------------------------------------------------------- |
| Micu / 米醋 API                          | `micu`             | OpenAI/Claude 兼容聚合网关 | 文档显示 CC Switch 可选 Micu 预设；OpenClaw 示例 base URL 为 `https://www.micuapi.ai` |
| API易                                    | `apiyi`            | OpenAI 标准聚合 API        | 文档宣称一个 token 调用 400+ 模型                                                     |
| 云雾 API                                 | `yunwu`            | AI API 中转站              | 提供统一接口调用主流模型                                                              |
| DMXAPI                                   | `relay-dmxapi`     | 多模型 API 聚合            | 面向 OpenAI/Claude/Gemini 等模型转发                                                  |
| Atlas Cloud                              | `relay-atlascloud` | OpenAI-compatible 聚合平台 | 文档宣称 300+ 模型统一 API                                                            |
| APINebula / RunAPI / CrazyRouter / Packy | `relay-*`          | 编程工具套餐和聚合 API     | 常见于 Claude Code/Codex 社区，需逐家核实文档                                         |

relay preset 规则：

- 第一版要覆盖常见国内中转站的轻量接入入口，即使 API 能力先留空。
- 默认只提供 `apiBaseUrl`、icon、homepage、purchase/top-up links、模型分组提示。
- `models` 可以来自平台“模型广场”或静态目录，但必须允许用户手动覆盖。
- 余额、状态、API key 创建、套餐剩余额度等能力必须逐家确认文档；未确认时只打开管理页。
- 这类平台价格、模型和可用渠道变化快，注册表需要 `lastVerifiedAt` 和文档链接。
- UI 应展示“中转平台”标识，避免用户误以为是底层官方 API。

Micu 示例：

```yaml
modelServices:
  micu:
    title: 米醋 API
    provider: micu
    apiKey: ${MICU_API_KEY}
```

如果平台要求特殊分组、协议或 user-agent，放在 `providerOptions` 或 adapter `extra`，不要硬编码到 provider 通用逻辑。

## 自建、本地与代理

这些不应放入 official provider：

- LiteLLM / One API / New API / 自建 OpenAI-compatible gateway
- Ollama / LM Studio / vLLM / llama.cpp server
- 公司内部网关、API Management、Cloudflare Worker proxy

它们使用 `custom` 模式，但可以提供模板：

- 预设 icon；
- 常见 base URL 示例；
- 本地模型 list/probe helper；
- 无官方余额/购买/状态能力。

## 第一版轻量接入

MVP registry 要允许能力为空或待接入：

```ts
interface ProviderCapabilities {
  listModels?: 'api' | 'static' | 'manual' | 'todo'
  accountStatus?: 'api' | 'page' | 'todo' | 'unsupported'
  secretCreate?: 'api' | 'page' | 'todo' | 'unsupported'
  serviceStatus?: 'api' | 'page' | 'todo' | 'unsupported'
}
```

第一版对常见平台至少提供：provider id、title、icon、category、homepage、API key、购买/充值、文档链接、默认 `apiBaseUrl` 或填写指引、“打开官网配置”按钮，以及“能力未接入，先使用管理页”提示。

用户可以手动填写 API key、模型 allowlist 和 override URL。后续再逐家补模型查询、余额、状态和 key 管理 API。

## 优先级

建议优先顺序：

1. Azure OpenAI：企业用户高频，配置形态和 OpenAI 差异最大。
2. Google Gemini API：官方 OpenAI-compatible，接入成本低。
3. OpenRouter、Requesty、AIMLAPI：海外 relay 高频，先做 preset、模型发现和购买入口。
4. Vercel AI Gateway、Cloudflare AI Gateway、Portkey、LiteLLM、Helicone：按 gateway/BYOK 场景建模。
5. Micu、API易、云雾、DMXAPI、Atlas Cloud：国内用户高频，先做 relay preset 和管理入口。
6. AWS Bedrock / Google Vertex：云 IAM 模型，需要单独认证层。
7. 百度千帆、腾讯混元、火山方舟：国内云厂商常见，和购买/实名/资源包流程相关。
8. Groq、Fireworks、Together、Mistral、xAI、SiliconFlow、DeepInfra、Novita：按用户需求逐步补 preset。

## 来源

- 云资源：Azure OpenAI `https://learn.microsoft.com/en-us/azure/foundry/openai/latest`，Azure models list `https://learn.microsoft.com/en-us/rest/api/azureopenai/models/list`，Gemini OpenAI compatibility `https://ai.google.dev/gemini-api/docs/openai`，Bedrock `ListFoundationModels` `https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html`
- 海外 relay/gateway：OpenRouter `https://openrouter.ai/docs/api/reference/overview`，OpenRouter credits `https://openrouter.ai/docs/api/api-reference/credits/get-credits`，Vercel AI Gateway `https://vercel.com/ai-gateway`，Requesty `https://docs.requesty.ai/quickstart`，AIMLAPI `https://docs.aimlapi.com/`，Portkey `https://docs.portkey.ai/docs/virtual_key_old/integrations/libraries/openai-compatible`，LiteLLM `https://docs.litellm.ai/docs/proxy/virtual_keys`，Helicone `https://docs.helicone.ai/gateway/overview`，Cloudflare `https://developers.cloudflare.com/ai-gateway/usage/chat-completion/`
- 推理平台：Eden AI `https://www.edenai.co/`，Groq `https://console.groq.com/docs/models`，Fireworks `https://docs.fireworks.ai/api-reference/list-models`，DeepInfra `https://docs.deepinfra.com/chat/overview`，Novita `https://novita.ai/docs/api-reference/api-reference-overview`
- 国内 relay：Micu `https://www.micuapi.ai/` / `https://docs.micuapi.ai/`，API易 `https://docs.apiyi.com/`，云雾 API `https://yunwu.ai/`，DMXAPI `https://dmxapi.com/`，Atlas Cloud `https://www.atlascloud.ai/zh/developer`
- 国内云厂商：百度千帆 `https://ai.baidu.com/ai-doc/WENXINWORKSHOP/2m3fihw8s`，腾讯混元 `https://cloud.tencent.com/document/product/1729/111007`，火山方舟 `https://www.volcengine.com/docs/82379/1330626`
