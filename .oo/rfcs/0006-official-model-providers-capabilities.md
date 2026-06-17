# RFC 0006：服务商注册表与能力矩阵

返回 [RFC 0006](./0006-official-model-providers.md)。

## 注册表

新增 `packages/core/src/model-providers/` 或 `packages/utils/src/model-providers/`，放纯粹的服务商定义。如果 schema 生成需要 enum，优先放 `packages/core`；如果只是运行时 helper 使用，优先放 `packages/utils`。

每个服务商定义包含：

- 稳定 provider id 与展示元信息；
- provider 内置图标；
- 默认 base URL 与区域 base URL 候选；
- 模型调用鉴权方式；
- `listModels`、`retrieveModel`、`getBalance`、`getCosts` 和 secret 动作的 endpoint builder；
- 文档链接与已知限制；
- 管理主页、API Key、用量、账单等 portal 链接；
- 官方状态页和可选状态 API；
- 必要时给 `extra.codex`、`extra.kimi`、`extra.gemini` 和 Claude Code Router 提供 adapter 默认值。

不要把 fetch 逻辑放进 adapter 包。服务商管理能力属于服务端 service，客户端不直接调用上游 API。

## 能力矩阵

| 服务商             | 服务 base URL                          |                                                查询模型 |                                                    余额或消费 |                                                     secret 创建 |
| ------------------ | -------------------------------------- | ------------------------------------------------------: | ------------------------------------------------------------: | --------------------------------------------------------------: |
| OpenAI             | `https://api.openai.com/v1`            |                      `GET /models`，支持 retrieve model |     Admin `GET /organization/costs`，是消费明细，不是现金余额 |               支持创建 Admin API key 和 project service account |
| Claude / Anthropic | `https://api.anthropic.com`            |                   `GET /v1/models`，支持 retrieve model |                         Admin usage/cost report，不是现金余额 | v1 按控制台或 OAuth admin 处理；不要用普通 API key 创建静态 key |
| Kimi 中国站        | `https://api.moonshot.cn/v1`           |                                        `GET /v1/models` |                                    `GET /v1/users/me/balance` |                                                      控制台创建 |
| Kimi 国际站        | `https://api.moonshot.ai/v1`           |                                        `GET /v1/models` |                                    `GET /v1/users/me/balance` |                                                      控制台创建 |
| DeepSeek           | `https://api.deepseek.com`             |                                           `GET /models` |                                           `GET /user/balance` |                                                      控制台创建 |
| MiniMax            | `https://api.minimax.io/v1`            |                   `GET /v1/models`，支持 retrieve model |                                            未找到公开余额 API |                                                      控制台创建 |
| 阿里千问           | 区域化 DashScope / Model Studio URL    | 官方文档未列出稳定公开 list endpoint；先用静态/手动目录 | 模型 API key 不能查阿里云账号余额；阿里云账单是另一套 OpenAPI |                             永久 key 走控制台；支持临时 key API |
| 智谱 GLM           | `https://open.bigmodel.cn/api/paas/v4` |       官方 API 索引指向模型总览，未文档化 list endpoint |                               模型 API 文档未找到公开余额 API |                                                      控制台创建 |

## 平台链接

| 服务商             | 管理主页                                                                               | API Key / secret 页面                                                                                                    | 账单、用量或购买入口                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| OpenAI             | `https://platform.openai.com/`                                                         | `https://platform.openai.com/api-keys`                                                                                   | `https://platform.openai.com/usage`，`https://platform.openai.com/settings/organization/billing/overview` |
| Claude / Anthropic | `https://platform.claude.com/`                                                         | `https://platform.claude.com/settings/keys`                                                                              | `https://platform.claude.com/usage`，`https://platform.claude.com/settings/billing`                       |
| Kimi 中国站        | `https://platform.kimi.com/`                                                           | `https://platform.kimi.com/console/api-keys`                                                                             | `https://platform.kimi.com/console`                                                                       |
| Kimi 国际站        | `https://platform.kimi.ai/`                                                            | `https://platform.kimi.ai/console/api-keys`                                                                              | `https://platform.kimi.ai/console`                                                                        |
| DeepSeek           | `https://platform.deepseek.com/`                                                       | `https://platform.deepseek.com/api_keys`                                                                                 | `https://platform.deepseek.com/usage`，`https://platform.deepseek.com/top_up`                             |
| MiniMax            | `https://platform.minimax.io/`                                                         | `https://platform.minimax.io/console/access`                                                                             | `https://platform.minimax.io/docs/pricing/overview`，`https://platform.minimax.io/console/plan`           |
| 阿里千问           | `https://bailian.console.aliyun.com/`，`https://modelstudio.console.alibabacloud.com/` | `https://bailian.console.aliyun.com/?tab=api#/api-key`，`https://modelstudio.console.alibabacloud.com/?tab=api#/api-key` | `https://usercenter2.aliyun.com/costmanage/`                                                              |
| 智谱 GLM           | `https://open.bigmodel.cn/`                                                            | `https://open.bigmodel.cn/usercenter/apikeys`                                                                            | `https://open.bigmodel.cn/usercenter/resourcepack`                                                        |

## MVP Preset 表

首版 registry 至少要让这些平台可被选择并打开管理入口。能力未确认时必须显式标 `manual`、`todo` 或 `unsupported`，不能从底层官方 API 推断。

| Provider ID             | Category        | 默认 API Base                     | 管理/Key/购买入口                                                               | v1 能力                                          |
| ----------------------- | --------------- | --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| `openrouter`            | relay           | `https://openrouter.ai/api/v1`    | `https://openrouter.ai/settings/keys`，`https://openrouter.ai/settings/credits` | list models API；credits 后续接入前余额先 manual |
| `requesty`              | relay           | `https://router.requesty.ai/v1`   | `https://app.requesty.ai/api-keys`，`https://app.requesty.ai/billing`           | 先使用通用模型查询或手动模型；余额 manual        |
| `vercel-ai-gateway`     | gateway         | `https://ai-gateway.vercel.sh/v1` | `https://vercel.com/ai-gateway`，`https://vercel.com/dashboard/usage`           | gateway preset；账单/status 走控制台             |
| `portkey`               | gateway         | `https://api.portkey.ai/v1`       | `https://app.portkey.ai/api-keys`，`https://app.portkey.ai/billing`             | virtual key/gateway preset；模型/余额 manual     |
| `litellm`               | gateway         | 用户填写                          | `https://www.litellm.ai`，`https://docs.litellm.ai`                             | 自托管/托管 gateway；能力 manual                 |
| `micu`                  | relay           | 待平台文档确认                    | `https://www.micuapi.ai/`，`https://docs.micuapi.ai/`                           | 国内 relay preset；能力 manual                   |
| `apiyi`                 | relay           | 待平台文档确认                    | `https://docs.apiyi.com/`                                                       | 国内 relay preset；能力 manual                   |
| `yunwu`                 | relay           | 待平台文档确认                    | `https://yunwu.ai/`                                                             | 国内 relay preset；能力 manual                   |
| `aimlapi`               | relay backlog   | `https://api.aimlapi.com/v1`      | `https://docs.aimlapi.com/`                                                     | 首版文档留位，registry 可后续补                  |
| `cloudflare-ai-gateway` | gateway backlog | 需要 account/gateway id           | `https://developers.cloudflare.com/ai-gateway/`                                 | 需要 providerOptions builder，先留 backlog       |
| `dmxapi` / `atlascloud` | relay backlog   | 待核实                            | 官网/文档入口                                                                   | 首版可先留文档，registry 后续补                  |

## Moonshot / Kimi 双站点

Moonshot 有两个公开文档站点：

- 中国站：文档在 `https://platform.kimi.com`，API host 是 `https://api.moonshot.cn`。
- 国际站：文档在 `https://platform.kimi.ai`，API host 是 `https://api.moonshot.ai`。

不要把它们合并成一个 `moonshot` provider。两边账号、key、账单、定价和合规边界都可能不同。provider id 使用 `moonshot-cn` 和 `moonshot-intl`；展示名可以统一叫 “Kimi / Moonshot”。

旧的 `platform.moonshot.cn` 文档地址会跳转到 `platform.kimi.com`。注册表里中国站文档链接应优先使用 canonical 的 `platform.kimi.com`。

## 阿里千问细节

阿里云百炼 / Model Studio 通过区域化 `compatible-mode/v1` base URL 暴露 OpenAI 兼容模型调用。公开文档列出的常见端点包括：

- 北京：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- 新加坡：`https://dashscope-intl.aliyuncs.com/compatible-mode/v1` 或 `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`，取决于区域和账号文档口径。
- 美国弗吉尼亚：`https://dashscope-us.aliyuncs.com/compatible-mode/v1`
- 中国香港：`https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1`
- 德国法兰克福：`https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1`

API Key 在控制台按区域和业务空间创建。因此 provider 配置需要 `providerOptions.region` 和可选 `providerOptions.workspaceId`；UI 保存前应展示最终 base URL。由于阿里中英文区域文档口径存在差异，用户必须能覆盖生成出来的 URL。

阿里还文档化了 `POST https://dashscope.aliyuncs.com/api/v1/tokens?expire_in_seconds=...` 用于生成临时 API Key。它继承永久 key 权限并自动过期，适合应用委派，但不适合作为长期模型服务配置。

## 智谱 GLM 细节

智谱公开文档定义的通用 API endpoint 是：

```text
https://open.bigmodel.cn/api/paas/v4
```

文档还区分了 Coding Plan endpoint：

```text
https://open.bigmodel.cn/api/coding/paas/v4
```

不要把 Coding endpoint 自动用于通用模型服务。只有用户明确选择时，才增加 `providerOptions.endpointKind: 'general' | 'coding'`。

智谱文档提供模型总览页，列出模型名、上下文和能力。在 API 索引公开稳定 list models 端点之前，先使用静态目录加手动模型条目。

## 来源

- OpenAI API Reference: [Models](https://developers.openai.com/api/reference/resources/models/methods/list), [Costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs), [Admin API Keys](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/admin_api_keys/methods/create), [Project Service Accounts](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/service_accounts/methods/create)
- Anthropic docs: [Models](https://platform.claude.com/docs/en/api/models/list), [Admin API](https://platform.claude.com/docs/en/api/admin)
- Kimi 中国站文档: [API Overview](https://platform.kimi.com/docs/api/overview), [List Models](https://platform.kimi.com/docs/api/list-models), [Balance](https://platform.kimi.com/docs/api/balance)
- Kimi 国际站文档: [API Overview](https://platform.kimi.ai/docs/api/overview), [List Models](https://platform.kimi.ai/docs/api/list-models), [Balance](https://platform.kimi.ai/docs/api/balance)
- DeepSeek docs: [List Models](https://api-docs.deepseek.com/api/list-models), [User Balance](https://api-docs.deepseek.com/api/get-user-balance), [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- MiniMax docs: [API Overview](https://platform.minimax.io/docs/api-reference/api-overview), [List Models](https://platform.minimax.io/docs/api-reference/models/openai/list-models), [Retrieve Model](https://platform.minimax.io/docs/api-reference/models/openai/retrieve-model)
- Alibaba Cloud Model Studio docs: [OpenAI compatible chat](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions), [Get API Key zh-CN](https://help.aliyun.com/zh/model-studio/get-api-key), [Get API Key en-US](https://www.alibabacloud.com/help/en/model-studio/get-api-key), [Temporary API Key](https://help.aliyun.com/zh/model-studio/generate-temporary-api-key), [Models](https://help.aliyun.com/zh/model-studio/models)
- 智谱文档: [API Introduction](https://docs.bigmodel.cn/cn/api/introduction), [Model Overview](https://docs.bigmodel.cn/cn/guide/start/model-overview)
