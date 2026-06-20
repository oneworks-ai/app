---
name: oneworks-model-services
description: Configure OneWorks model services using built-in provider defaults, management portals, API base URLs, model lists, balance/status capabilities, and safe config-source writeback.
---

Use this skill when a user wants to add, update, or troubleshoot OneWorks `modelServices`.

## Writeback Rules

- Put account-level API keys and secrets in global config by default.
- Use project or user config only when the user explicitly asks for an override.
- Do not copy values from merged config back into a source file unless you know the target source.
- Never show API keys, secrets, tokens, or passwords in the final answer.
- If the selected provider is known, prefer built-in defaults for `provider`, `homepageUrl`, `apiBaseUrl`, models, icons, and management capabilities. Only write override fields when the user asks for an override.

## Config Shape

Use `modelServices.<serviceKey>` with these common fields:

- `provider`: built-in provider id.
- `title`: display name.
- `description`: short display description.
- `apiKey`: service API key or secret.
- `apiBaseUrl`: only needed for custom services or explicit overrides.
- `models`: only needed for custom services or explicit overrides.
- `billing`: optional metadata for billing kind, key kind, quota unit, quota windows, and allowed use.
- `codingPlan`: optional metadata for plan links, protocol base URLs, regions, default models, and restrictions.
- `homepageUrl`: only needed to override the provider portal.
- `management.enabled`: enables model/balance/status/secret helper actions when available.
- `management.apiKey`: optional separate management API key; otherwise reuse `apiKey` when supported.

## Coding Plan and Token Plan Rules

Here "Coding Plan" means a provider billing/quota product, not OneWorks or agent Plan Mode.

- Do not mix plan keys and ordinary pay-as-you-go API keys. A Coding Plan or Token Plan normally needs its dedicated key and dedicated base URL.
- Prefer built-in plan provider ids instead of overriding ordinary API providers:
  - `kimi-code`: Kimi Code, OpenAI `https://api.kimi.com/coding/v1`, Anthropic `https://api.kimi.com/coding/`, model `kimi-for-coding`, Kimi Code API key from the Kimi Code console. Models and quota can be queried through the dedicated `/coding/v1` API; do not use Moonshot/Kimi Platform PAYG balance endpoints for it.
  - `minimax-token-plan`: MiniMax Token Plan, OpenAI `https://api.minimax.io/v1`, Anthropic `https://api.minimax.io/anthropic`, China Anthropic `https://api.minimaxi.com/anthropic`, model `MiniMax-M3`, Subscription Key.
  - `qwen-coding-plan`: Alibaba Cloud Model Studio Coding Plan, OpenAI `https://coding.dashscope.aliyuncs.com/v1`, Anthropic `https://coding.dashscope.aliyuncs.com/apps/anthropic`, international OpenAI `https://coding-intl.dashscope.aliyuncs.com/v1`, international Anthropic `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic`, plan key commonly `sk-sp-*`.
  - `zhipu-coding-plan`: Zhipu GLM Coding Plan, OpenAI `https://open.bigmodel.cn/api/coding/paas/v4`, Anthropic `https://open.bigmodel.cn/api/anthropic`, model `GLM-5.2`.
  - `tencent-tokenhub-coding-plan`: Tencent Cloud TokenHub Coding Plan, OpenAI `https://api.lkeap.cloud.tencent.com/coding/v3`, Anthropic `https://api.lkeap.cloud.tencent.com/coding/anthropic`.
  - `volcengine-ark-coding-plan`: Volcengine Ark Coding Plan, OpenAI `https://ark.cn-beijing.volces.com/api/coding/v3`, Anthropic `https://ark.cn-beijing.volces.com/api/coding`.
  - `baidu-qianfan-coding-plan`: Baidu Qianfan Coding Plan, OpenAI `https://qianfan.baidubce.com/v2/coding`, Anthropic `https://qianfan.baidubce.com/anthropic/coding`.
- OpenAI Codex and Anthropic Claude Code subscriptions are product-login entitlements, not model service API keys. ChatGPT/Codex and `claude login` can use subscription quotas, while OpenAI/Anthropic API keys still bill as ordinary API usage.
- Many plan quotas are request-window based, such as 5-hour, weekly, or monthly request limits. Do not describe them as ordinary token quotas unless the provider calls the product a Token Plan.
- Many providers restrict plans to interactive coding tools and disallow backend batch jobs, automation scripts, or generic API load. Preserve `billing.allowedUse: coding_tools_only` and show the restriction to the user.
- Plan model lists are catalog defaults and may not be available from `/v1/models`. Leave `models` empty to use the built-in catalog, or write `models` only when the user explicitly wants an allowlist override.
- DeepSeek is currently a pay-as-you-go API provider with coding-agent integrations, not a dedicated Coding Plan provider in this registry.

## Built-In Providers

Official providers:

- `openai`: OpenAI, `https://api.openai.com/v1`; portal `https://platform.openai.com`; API keys `https://platform.openai.com/api-keys`; docs `https://platform.openai.com/docs`; status `https://status.openai.com`; model listing via API; balance unsupported.
- `anthropic`: Anthropic, `https://api.anthropic.com/v1`; portal `https://console.anthropic.com`; API keys `https://console.anthropic.com/settings/keys`; billing `https://console.anthropic.com/settings/billing`; docs `https://docs.anthropic.com`; status `https://status.claude.com`; model listing manual.
  - Claude Code should use Anthropic directly with `ANTHROPIC_API_KEY`; OneWorks normalizes `https://api.anthropic.com/v1` to `https://api.anthropic.com` for the native CLI.
- `moonshot-cn`: Moonshot/Kimi China, `https://api.moonshot.cn/v1`; model and balance APIs are supported, so prefer refreshing and saving the provider model list, then use the first saved model as the default candidate. Built-in fallback models are `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5`, `kimi-k2-0905-preview`, `kimi-k2`. Portal `https://platform.kimi.com`; API keys `https://platform.kimi.com/console/api-keys`; billing `https://platform.kimi.com/console/account`; docs `https://platform.kimi.com/docs`; status `https://status.moonshot.cn`.
  - Claude Code should use Kimi's official Anthropic API adapter at `https://api.moonshot.cn/anthropic` instead of routing through Claude Code Router's OpenAI conversion path.
- `moonshot-intl`: Moonshot/Kimi International, `https://api.moonshot.ai/v1`; model and balance APIs are supported, so prefer refreshing and saving the provider model list, then use the first saved model as the default candidate. Built-in fallback models are `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5`, `kimi-k2-0905-preview`, `kimi-k2`. Portal `https://platform.kimi.ai`; API keys `https://platform.kimi.ai/console/api-keys`; billing `https://platform.kimi.ai/console/account`; docs `https://platform.kimi.ai/docs`; status `https://status.moonshot.cn`.
  - Claude Code should use Kimi's official Anthropic API adapter at `https://api.moonshot.ai/anthropic` instead of routing through Claude Code Router's OpenAI conversion path.
- `deepseek`: DeepSeek, `https://api.deepseek.com`; default models `deepseek-v4-flash`, `deepseek-v4-pro`, with legacy aliases `deepseek-chat`, `deepseek-reasoner` kept for compatibility until their documented 2026-07-24 deprecation; portal `https://platform.deepseek.com`; API keys `https://platform.deepseek.com/api_keys`; billing `https://platform.deepseek.com/usage`; docs `https://api-docs.deepseek.com`; status `https://status.deepseek.com`; model and balance APIs are supported.
  - Claude Code should use DeepSeek's official Anthropic API adapter at `https://api.deepseek.com/anthropic` instead of routing through Claude Code Router's OpenAI conversion path.
- `minimax`: MiniMax, `https://api.minimax.io/v1`; default model `MiniMax-M3`; portal `https://platform.minimaxi.com`; API keys `https://platform.minimaxi.com/user-center/basic-information/interface-key`; billing `https://platform.minimaxi.com/user-center/basic-information/interface-balance`; docs `https://platform.minimaxi.com/document`; status `https://status.minimax.io`; model API supported, balance manual.
  - Claude Code should use MiniMax's official Anthropic API adapter at `https://api.minimax.io/anthropic` for international accounts or `https://api.minimaxi.com/anthropic` for China accounts. OneWorks preserves the configured host and switches the path to `/anthropic`.
- `minimax-token-plan`: MiniMax Token Plan; use Subscription Key, not a pay-as-you-go API key. Leave `models` empty for `MiniMax-M3`; Claude Code should use the plan Anthropic endpoint from the registry.
- `qwen`: Alibaba Qwen / Bailian, `https://dashscope.aliyuncs.com/compatible-mode/v1`; default Claude Code compatible models `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-flash`, `qwen3.5-plus`, `qwen3-coder-next`, `qwen3-coder-plus`; portal `https://bailian.console.aliyun.com`; API keys `https://bailian.console.aliyun.com/?tab=api#/api-key`; billing `https://usercenter2.aliyun.com/finance`; docs `https://help.aliyun.com/zh/model-studio`; model list is static.
  - Claude Code should use Bailian's official Anthropic-compatible endpoints, for example pay-as-you-go `https://dashscope.aliyuncs.com/apps/anthropic`, Coding Plan `https://coding.dashscope.aliyuncs.com/apps/anthropic`, Token Plan `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`, or the regional workspace host ending in `/apps/anthropic`.
- `qwen-coding-plan`: Alibaba Cloud Model Studio Coding Plan; use the Coding Plan key with the Coding Plan endpoint. Do not use the ordinary DashScope key/base URL for this service.
- `zhipu`: Zhipu GLM, `https://open.bigmodel.cn/api/paas/v4`; default Claude Code compatible models `glm-5.2[1m]`, `glm-5.2`, `glm-4.7`, `glm-4.5-air`; portal `https://open.bigmodel.cn`; API keys `https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys`; billing `https://open.bigmodel.cn/usercenter/resourcepool`; docs `https://docs.bigmodel.cn`; model list is static.
  - Claude Code should use Zhipu's official Anthropic-compatible endpoint at `https://open.bigmodel.cn/api/anthropic`. For `glm-5.2[1m]`, keep `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000`; use `glm-4.5-air` for the Haiku slot when available.
- `zhipu-coding-plan`: Zhipu GLM Coding Plan; use the coding endpoint and coding-plan key. Ordinary BigModel endpoints do not count against the plan.
- `kimi-code`, `tencent-tokenhub-coding-plan`, `volcengine-ark-coding-plan`, and `baidu-qianfan-coding-plan` are dedicated coding subscription providers with static model catalogs and dedicated OpenAI/Anthropic-compatible endpoints.

Cloud providers:

- `azure-openai`: Azure OpenAI through Azure AI Foundry; portal `https://ai.azure.com`; billing in Azure portal; docs `https://learn.microsoft.com/azure/ai-services/openai`; status `https://status.azure.com`.
- `google-gemini`: Google Gemini OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai`; portal `https://aistudio.google.com`; API keys `https://aistudio.google.com/apikey`; billing `https://console.cloud.google.com/billing`; docs `https://ai.google.dev/gemini-api/docs`.
- `aws-bedrock`: AWS Bedrock; portal `https://console.aws.amazon.com/bedrock`; billing `https://console.aws.amazon.com/billing`; docs `https://docs.aws.amazon.com/bedrock`; status `https://health.aws.amazon.com/health/status`.

Relay and gateway providers:

- `openrouter`: `https://openrouter.ai/api/v1`; portal `https://openrouter.ai`; API keys `https://openrouter.ai/settings/keys`; billing `https://openrouter.ai/settings/credits`; docs `https://openrouter.ai/docs`.
  - Claude Code should use OpenRouter's Anthropic Skin directly at `https://openrouter.ai/api`, with `ANTHROPIC_AUTH_TOKEN` and empty `ANTHROPIC_API_KEY`.
- `vercel-ai-gateway`: `https://ai-gateway.vercel.sh/v1`; portal `https://vercel.com/ai-gateway`; billing `https://vercel.com/dashboard/usage`; docs `https://vercel.com/docs/ai-gateway`.
  - Claude Code should use Vercel AI Gateway's Anthropic-compatible endpoint at `https://ai-gateway.vercel.sh`, with `ANTHROPIC_AUTH_TOKEN` and empty `ANTHROPIC_API_KEY`.
- `requesty`: `https://router.requesty.ai/v1`; portal `https://requesty.ai`; API keys `https://app.requesty.ai/api-keys`; billing `https://app.requesty.ai/billing`; docs `https://docs.requesty.ai`.
  - Claude Code should use Requesty's Anthropic-compatible gateway at `https://router.requesty.ai`, with model IDs such as `provider/model-name` or `policy/name`.
- `portkey`: `https://api.portkey.ai/v1`; portal `https://portkey.ai`; API keys `https://app.portkey.ai/api-keys`; billing `https://app.portkey.ai/billing`; docs `https://portkey.ai/docs`.
  - Claude Code should use Portkey's unified endpoint at `https://api.portkey.ai`. If a Portkey provider slug is required, configure `extra.claudeCode.portkeyProvider`, or set full `extra.claudeCode.anthropicCustomHeaders`.
- `litellm`: LiteLLM gateway; portal `https://www.litellm.ai`; docs `https://docs.litellm.ai`.
- `micu`: Micu relay; portal and docs `https://micu.hk`.
- `apiyi`: APIYI relay; portal and docs `https://apiyi.com`.
- `yunwu`: Yunwu relay; portal and docs `https://yunwu.ai`.
- `custom-openai-compatible`: user-defined OpenAI-compatible endpoint; requires explicit `apiBaseUrl`, usually explicit `models`, and manual management links.

## Workflow

1. Confirm provider, region/site when relevant, API key, whether defaults should be used, and whether management helpers should be enabled.
2. If the provider has a portal, guide the user to open the portal for login, billing/top-up, and secret/API-key creation.
3. Write the minimal config: use `provider` plus `apiKey`; omit `apiBaseUrl`, `models`, `homepageUrl`, and icon fields when built-in defaults are enough.
4. For custom OpenAI-compatible services, ask for `apiBaseUrl`, supported model ids, homepage, and any billing/API-key URLs.
5. After saving, verify with model listing or a short chat request when credentials are available.
