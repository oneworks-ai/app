/* eslint-disable max-lines -- official provider catalog keeps service metadata in one registry */
import type {
  IconRef,
  ModelProviderCapabilities,
  ModelProviderCodingPlanDefinition,
  ModelProviderDefinition,
  ModelProviderPortalLinks,
  ModelServiceBillingConfig
} from '@oneworks/types'

const builtinIcon = (id: string): IconRef => ({ kind: 'builtin', id })
const portal = (homepage: string, links?: Omit<ModelProviderPortalLinks, 'homepage'>): ModelProviderPortalLinks => ({
  homepage,
  console: homepage,
  ...links
})
const capabilities = (overrides?: ModelProviderCapabilities): ModelProviderCapabilities => ({
  listModels: 'manual',
  balance: 'manual',
  secrets: 'manual',
  status: 'manual',
  ...overrides
})
const statuspage = (pageUrl: string, componentMatchers?: string[]) => ({
  kind: 'statuspage' as const,
  pageUrl,
  summaryUrl: `${pageUrl.replace(/\/+$/u, '')}/api/v2/summary.json`,
  statusUrl: `${pageUrl.replace(/\/+$/u, '')}/api/v2/status.json`,
  componentMatchers
})
const planBilling = (
  kind: NonNullable<ModelServiceBillingConfig['kind']>,
  keyKind: NonNullable<ModelServiceBillingConfig['keyKind']>,
  quotaUnit: NonNullable<ModelServiceBillingConfig['quotaUnit']> = 'request'
): ModelServiceBillingConfig => ({
  kind,
  keyKind,
  quotaUnit,
  quotaWindows: quotaUnit === 'token' || quotaUnit === 'credit' ? ['monthly'] : ['5h', 'weekly', 'monthly'],
  allowedUse: 'coding_tools_only'
})
const codingPlan = (
  definition: Omit<ModelProviderCodingPlanDefinition, 'official' | 'supported'>
): ModelProviderCodingPlanDefinition => ({
  supported: true,
  official: true,
  ...definition
})

const CODING_TOOLS_ONLY_RESTRICTION =
  'Only use this plan from interactive coding tools; do not use it for backend batch jobs, automation scripts, or general API workloads.'
const DEDICATED_KEY_RESTRICTION =
  'Use the plan-specific key with the plan-specific base URL. Pay-as-you-go API keys and normal API base URLs are not interchangeable.'
const kimiCodeBilling = (): ModelServiceBillingConfig => ({
  ...planBilling('coding_plan', 'coding_plan_key', 'percent'),
  quotaWindows: ['5h', 'weekly']
})

export const MODEL_PROVIDER_DEFINITIONS = [
  {
    id: 'openai',
    title: 'OpenAI',
    category: 'official',
    icon: builtinIcon('openai'),
    description: 'Official OpenAI API platform for GPT models and multimodal services.',
    defaultApiBaseUrl: 'https://api.openai.com/v1',
    defaultModels: ['gpt-5', 'gpt-5-mini'],
    portal: portal('https://platform.openai.com', {
      billing: 'https://platform.openai.com/settings/organization/billing/overview',
      apiKeys: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      status: 'https://status.openai.com'
    }),
    capabilities: capabilities({ listModels: 'api', balance: 'unsupported', status: 'api' }),
    status: statuspage('https://status.openai.com')
  },
  {
    id: 'anthropic',
    title: 'Anthropic',
    category: 'official',
    icon: builtinIcon('anthropic'),
    description: 'Official Anthropic Console service for Claude models.',
    defaultApiBaseUrl: 'https://api.anthropic.com/v1',
    portal: portal('https://console.anthropic.com', {
      billing: 'https://console.anthropic.com/settings/billing',
      apiKeys: 'https://console.anthropic.com/settings/keys',
      docs: 'https://docs.anthropic.com',
      status: 'https://status.claude.com'
    }),
    capabilities: capabilities({ listModels: 'manual', status: 'api' }),
    status: statuspage('https://status.claude.com', ['Claude API'])
  },
  {
    id: 'moonshot-cn',
    title: 'Moonshot China',
    category: 'official',
    icon: builtinIcon('moonshot'),
    description: 'Moonshot/Kimi China official OpenAI-compatible API service.',
    defaultApiBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModels: ['kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2'],
    portal: portal('https://platform.kimi.com', {
      billing: 'https://platform.kimi.com/console/account',
      apiKeys: 'https://platform.kimi.com/console/api-keys',
      docs: 'https://platform.kimi.com/docs',
      status: 'https://status.moonshot.cn'
    }),
    capabilities: capabilities({ listModels: 'api', balance: 'api', status: 'api' }),
    status: statuspage('https://status.moonshot.cn', ['Open API'])
  },
  {
    id: 'moonshot-intl',
    title: 'Moonshot International',
    category: 'official',
    icon: builtinIcon('moonshot'),
    description: 'Moonshot/Kimi international official OpenAI-compatible API service.',
    defaultApiBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModels: ['kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2'],
    portal: portal('https://platform.kimi.ai', {
      billing: 'https://platform.kimi.ai/console/account',
      apiKeys: 'https://platform.kimi.ai/console/api-keys',
      docs: 'https://platform.kimi.ai/docs',
      status: 'https://status.moonshot.cn'
    }),
    capabilities: capabilities({ listModels: 'api', balance: 'api', status: 'api' }),
    status: statuspage('https://status.moonshot.cn', ['Open API'])
  },
  {
    id: 'kimi-code',
    title: 'Kimi Code',
    category: 'official',
    icon: builtinIcon('moonshot'),
    description: 'Kimi Code membership benefit endpoint for coding agents.',
    defaultApiBaseUrl: 'https://api.kimi.com/coding/v1',
    defaultModels: ['kimi-for-coding'],
    billing: kimiCodeBilling(),
    codingPlan: codingPlan({
      kind: 'coding_plan',
      title: 'Kimi Code',
      planHomeUrl: 'https://www.kimi.com/code',
      keyHomeUrl: 'https://www.kimi.com/code/console',
      docsUrl: 'https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html',
      billing: kimiCodeBilling(),
      protocols: {
        openai: { baseUrl: 'https://api.kimi.com/coding/v1' },
        anthropic: { baseUrl: 'https://api.kimi.com/coding/' }
      },
      defaultModels: ['kimi-for-coding'],
      restrictions: [
        DEDICATED_KEY_RESTRICTION,
        CODING_TOOLS_ONLY_RESTRICTION,
        'Kimi Code uses a separate base URL from the Moonshot Open Platform API.'
      ]
    }),
    portal: portal('https://www.kimi.com/code', {
      purchase: 'https://www.kimi.com/code',
      apiKeys: 'https://www.kimi.com/code/console',
      docs: 'https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html'
    }),
    capabilities: capabilities({ listModels: 'api', balance: 'api', status: 'manual' })
  },
  {
    id: 'deepseek',
    title: 'DeepSeek',
    category: 'official',
    icon: builtinIcon('deepseek'),
    description: 'Official DeepSeek OpenAI-compatible API service.',
    defaultApiBaseUrl: 'https://api.deepseek.com',
    defaultModels: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    portal: portal('https://platform.deepseek.com', {
      billing: 'https://platform.deepseek.com/usage',
      apiKeys: 'https://platform.deepseek.com/api_keys',
      docs: 'https://api-docs.deepseek.com',
      status: 'https://status.deepseek.com'
    }),
    capabilities: capabilities({ listModels: 'api', balance: 'api', status: 'manual' }),
    status: { kind: 'page_only' as const, pageUrl: 'https://status.deepseek.com' }
  },
  {
    id: 'minimax',
    title: 'MiniMax',
    category: 'official',
    icon: builtinIcon('minimax'),
    description: 'Official MiniMax API platform for chat, multimodal, and agent services.',
    defaultApiBaseUrl: 'https://api.minimax.io/v1',
    defaultModels: ['MiniMax-M3'],
    portal: portal('https://platform.minimaxi.com', {
      billing: 'https://platform.minimaxi.com/user-center/basic-information/interface-balance',
      apiKeys: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      docs: 'https://platform.minimaxi.com/document',
      status: 'https://status.minimax.io'
    }),
    capabilities: capabilities({ listModels: 'api', balance: 'manual', status: 'api' }),
    status: statuspage('https://status.minimax.io', ['Large Language Models', 'LLM'])
  },
  {
    id: 'minimax-token-plan',
    title: 'MiniMax Token Plan',
    category: 'official',
    icon: builtinIcon('minimax'),
    description: 'MiniMax Token Plan subscription endpoint for MiniMax M-series coding models.',
    defaultApiBaseUrl: 'https://api.minimax.io/v1',
    defaultModels: ['MiniMax-M3'],
    billing: planBilling('token_plan', 'subscription_key', 'token'),
    codingPlan: codingPlan({
      kind: 'token_plan',
      title: 'MiniMax Token Plan',
      planHomeUrl: 'https://platform.minimax.io/docs/token-plan/quickstart',
      keyHomeUrl: 'https://platform.minimax.io/docs/token-plan/quickstart',
      docsUrl: 'https://platform.minimax.io/docs/token-plan/quickstart',
      billing: planBilling('token_plan', 'subscription_key', 'token'),
      protocols: {
        openai: { baseUrl: 'https://api.minimax.io/v1' },
        anthropic: { baseUrl: 'https://api.minimax.io/anthropic' }
      },
      regions: [{
        id: 'china',
        label: 'China',
        protocols: {
          openai: { baseUrl: 'https://api.minimaxi.com/v1' },
          anthropic: { baseUrl: 'https://api.minimaxi.com/anthropic' }
        }
      }],
      defaultModels: ['MiniMax-M3'],
      restrictions: [
        DEDICATED_KEY_RESTRICTION,
        'Use the Subscription Key for Token Plan seats and credits. It is not interchangeable with pay-as-you-go API keys.'
      ]
    }),
    portal: portal('https://platform.minimax.io', {
      billing: 'https://platform.minimax.io/docs/token-plan/quickstart',
      apiKeys: 'https://platform.minimax.io/docs/token-plan/quickstart',
      docs: 'https://platform.minimax.io/docs/token-plan/quickstart',
      status: 'https://status.minimax.io'
    }),
    capabilities: capabilities({ listModels: 'static', balance: 'manual', status: 'manual' }),
    status: statuspage('https://status.minimax.io', ['Large Language Models', 'LLM'])
  },
  {
    id: 'qwen',
    title: 'Alibaba Qwen',
    category: 'official',
    icon: builtinIcon('qwen'),
    description: 'Alibaba Cloud Bailian/DashScope API service for Qwen models.',
    defaultApiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModels: [
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.6-flash',
      'qwen3.5-plus',
      'qwen3-coder-next',
      'qwen3-coder-plus'
    ],
    portal: portal('https://bailian.console.aliyun.com', {
      billing: 'https://usercenter2.aliyun.com/finance',
      apiKeys: 'https://bailian.console.aliyun.com/?tab=api#/api-key',
      docs: 'https://help.aliyun.com/zh/model-studio',
      status: 'https://status.aliyun.com'
    }),
    capabilities: capabilities({ listModels: 'static', secrets: 'manual', status: 'manual' }),
    status: { kind: 'cloud_status_openapi' as const, pageUrl: 'https://status.aliyun.com', requiresCredentials: true }
  },
  {
    id: 'qwen-coding-plan',
    title: 'Alibaba Coding Plan',
    category: 'official',
    icon: builtinIcon('qwen'),
    description: 'Alibaba Cloud Model Studio Coding Plan endpoint for coding agents.',
    defaultApiBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModels: [
      'qwen3.7-plus',
      'qwen3.6-plus',
      'kimi-k2.5',
      'glm-5',
      'MiniMax-M2.5',
      'qwen3-coder-next',
      'qwen3-coder-plus'
    ],
    billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
    codingPlan: codingPlan({
      kind: 'coding_plan',
      title: 'Alibaba Cloud Model Studio Coding Plan',
      planHomeUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan',
      keyHomeUrl: 'https://bailian.console.aliyun.com/?tab=codingplan#/coding-plan',
      docsUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan',
      billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
      protocols: {
        openai: { baseUrl: 'https://coding.dashscope.aliyuncs.com/v1' },
        anthropic: { baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic' }
      },
      regions: [{
        id: 'intl',
        label: 'International',
        protocols: {
          openai: { baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1' },
          anthropic: { baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic' }
        }
      }],
      defaultModels: [
        'qwen3.7-plus',
        'qwen3.6-plus',
        'kimi-k2.5',
        'glm-5',
        'MiniMax-M2.5',
        'qwen3-coder-next',
        'qwen3-coder-plus'
      ],
      restrictions: [
        DEDICATED_KEY_RESTRICTION,
        CODING_TOOLS_ONLY_RESTRICTION,
        'Coding Plan keys commonly use the sk-sp-* prefix.'
      ]
    }),
    portal: portal('https://bailian.console.aliyun.com/?tab=codingplan#/coding-plan', {
      purchase: 'https://help.aliyun.com/zh/model-studio/coding-plan',
      billing: 'https://bailian.console.aliyun.com/?tab=codingplan#/coding-plan',
      apiKeys: 'https://bailian.console.aliyun.com/?tab=codingplan#/coding-plan',
      docs: 'https://help.aliyun.com/zh/model-studio/coding-plan',
      status: 'https://status.aliyun.com'
    }),
    capabilities: capabilities({ listModels: 'static', secrets: 'manual', status: 'manual' }),
    status: { kind: 'cloud_status_openapi' as const, pageUrl: 'https://status.aliyun.com', requiresCredentials: true }
  },
  {
    id: 'zhipu',
    title: 'Zhipu GLM',
    category: 'official',
    icon: builtinIcon('zhipu'),
    description: 'Zhipu BigModel official API service for GLM models.',
    defaultApiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModels: ['glm-5.2[1m]', 'glm-5.2', 'glm-4.7', 'glm-4.5-air'],
    portal: portal('https://open.bigmodel.cn', {
      billing: 'https://open.bigmodel.cn/usercenter/resourcepool',
      apiKeys: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
      docs: 'https://docs.bigmodel.cn'
    }),
    capabilities: capabilities({ listModels: 'static', status: 'unsupported' }),
    status: { kind: 'unsupported' as const }
  },
  {
    id: 'zhipu-coding-plan',
    title: 'Zhipu GLM Coding Plan',
    category: 'official',
    icon: builtinIcon('zhipu'),
    description: 'Zhipu GLM Coding Plan endpoint for supported coding tools.',
    defaultApiBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    defaultModels: ['GLM-5.2'],
    billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
    codingPlan: codingPlan({
      kind: 'coding_plan',
      title: 'GLM Coding Plan',
      planHomeUrl: 'https://docs.bigmodel.cn/cn/coding-plan/quick-start',
      keyHomeUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
      docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/quick-start',
      billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
      protocols: {
        openai: { baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' },
        anthropic: { baseUrl: 'https://open.bigmodel.cn/api/anthropic' }
      },
      defaultModels: ['GLM-5.2'],
      restrictions: [
        DEDICATED_KEY_RESTRICTION,
        CODING_TOOLS_ONLY_RESTRICTION,
        'GLM Coding Plan is only for officially supported coding tools and product environments.'
      ]
    }),
    portal: portal('https://open.bigmodel.cn', {
      billing: 'https://docs.bigmodel.cn/cn/coding-plan/quick-start',
      apiKeys: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
      docs: 'https://docs.bigmodel.cn/cn/coding-plan/quick-start'
    }),
    capabilities: capabilities({ listModels: 'static', status: 'manual' }),
    status: { kind: 'unsupported' as const }
  },
  {
    id: 'tencent-tokenhub-coding-plan',
    title: 'Tencent TokenHub Coding Plan',
    category: 'official',
    icon: builtinIcon('tencent'),
    description: 'Tencent Cloud TokenHub Coding Plan endpoint for coding agents.',
    defaultApiBaseUrl: 'https://api.lkeap.cloud.tencent.com/coding/v3',
    defaultModels: ['tc-code-latest', 'hunyuan-2.0-instruct', 'minimax-m2.5', 'kimi-k2.5', 'glm-5'],
    billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
    codingPlan: codingPlan({
      kind: 'coding_plan',
      title: 'Tencent Cloud TokenHub Coding Plan',
      planHomeUrl: 'https://cloud.tencent.com/document/product/1823/130092',
      keyHomeUrl: 'https://cloud.tencent.com/document/product/1823/130092',
      docsUrl: 'https://cloud.tencent.com/document/product/1823/130092',
      billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
      protocols: {
        openai: { baseUrl: 'https://api.lkeap.cloud.tencent.com/coding/v3' },
        anthropic: { baseUrl: 'https://api.lkeap.cloud.tencent.com/coding/anthropic' }
      },
      defaultModels: ['tc-code-latest', 'hunyuan-2.0-instruct', 'minimax-m2.5', 'kimi-k2.5', 'glm-5'],
      restrictions: [
        DEDICATED_KEY_RESTRICTION,
        CODING_TOOLS_ONLY_RESTRICTION,
        'Coding Plan keys commonly use the sk-sp-* prefix and are not compatible with Tencent prepaid or postpaid API keys.'
      ]
    }),
    portal: portal('https://cloud.tencent.com/document/product/1823/130092', {
      purchase: 'https://cloud.tencent.com/document/product/1823/130092',
      apiKeys: 'https://cloud.tencent.com/document/product/1823/130092',
      docs: 'https://cloud.tencent.com/document/product/1823/130092'
    }),
    capabilities: capabilities({ listModels: 'static', status: 'manual' })
  },
  {
    id: 'volcengine-ark-coding-plan',
    title: 'Volcengine Ark Coding Plan',
    category: 'official',
    icon: builtinIcon('volcengine'),
    description: 'Volcengine Ark Coding Plan endpoint for coding agents.',
    defaultApiBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    defaultModels: ['doubao-seed-2.0-pro', 'glm-5.1', 'kimi-k2.6', 'minimax-m2.7'],
    billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
    codingPlan: codingPlan({
      kind: 'coding_plan',
      title: 'Volcengine Ark Coding Plan',
      planHomeUrl: 'https://www.volcengine.com/activity/codingplan',
      keyHomeUrl: 'https://www.volcengine.com/docs/82379/1928261',
      docsUrl: 'https://www.volcengine.com/docs/82379/1928261',
      billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
      protocols: {
        openai: { baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3' },
        anthropic: { baseUrl: 'https://ark.cn-beijing.volces.com/api/coding' }
      },
      defaultModels: ['doubao-seed-2.0-pro', 'glm-5.1', 'kimi-k2.6', 'minimax-m2.7'],
      restrictions: [
        DEDICATED_KEY_RESTRICTION,
        CODING_TOOLS_ONLY_RESTRICTION,
        'Do not use the normal Ark API endpoint for Coding Plan traffic.'
      ]
    }),
    portal: portal('https://www.volcengine.com/activity/codingplan', {
      purchase: 'https://www.volcengine.com/activity/codingplan',
      apiKeys: 'https://www.volcengine.com/docs/82379/1928261',
      docs: 'https://www.volcengine.com/docs/82379/1928261'
    }),
    capabilities: capabilities({ listModels: 'static', status: 'manual' })
  },
  {
    id: 'baidu-qianfan-coding-plan',
    title: 'Baidu Qianfan Coding Plan',
    category: 'official',
    icon: builtinIcon('baidu'),
    description: 'Baidu Qianfan Coding Plan endpoint for coding agents.',
    defaultApiBaseUrl: 'https://qianfan.baidubce.com/v2/coding',
    defaultModels: [
      'qianfan-code-latest',
      'kimi-k2.5',
      'deepseek-v3.2',
      'glm-5',
      'minimax-m2.5',
      'ernie-4.5-turbo-20260402',
      'deepseek-v4-flash',
      'glm-5.1'
    ],
    billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
    codingPlan: codingPlan({
      kind: 'coding_plan',
      title: 'Baidu Qianfan Coding Plan',
      planHomeUrl: 'https://cloud.baidu.com/doc/qianfan/s/imlg0beiu',
      keyHomeUrl: 'https://cloud.baidu.com/doc/qianfan/s/imlg0beiu',
      docsUrl: 'https://cloud.baidu.com/doc/qianfan/s/imlg0beiu',
      billing: planBilling('coding_plan', 'coding_plan_key', 'request'),
      protocols: {
        openai: { baseUrl: 'https://qianfan.baidubce.com/v2/coding' },
        anthropic: { baseUrl: 'https://qianfan.baidubce.com/anthropic/coding' }
      },
      defaultModels: [
        'qianfan-code-latest',
        'kimi-k2.5',
        'deepseek-v3.2',
        'glm-5',
        'minimax-m2.5',
        'ernie-4.5-turbo-20260402',
        'deepseek-v4-flash',
        'glm-5.1'
      ],
      restrictions: [
        DEDICATED_KEY_RESTRICTION,
        CODING_TOOLS_ONLY_RESTRICTION,
        'Coding Plan API keys are only valid on the Qianfan Coding Plan endpoints.'
      ]
    }),
    portal: portal('https://cloud.baidu.com/doc/qianfan/s/imlg0beiu', {
      purchase: 'https://cloud.baidu.com/doc/qianfan/s/imlg0beiu',
      apiKeys: 'https://cloud.baidu.com/doc/qianfan/s/imlg0beiu',
      docs: 'https://cloud.baidu.com/doc/qianfan/s/imlg0beiu'
    }),
    capabilities: capabilities({ listModels: 'static', status: 'manual' })
  },
  {
    id: 'azure-openai',
    title: 'Azure OpenAI',
    category: 'cloud',
    icon: builtinIcon('azure'),
    description: 'Azure-hosted OpenAI model deployments managed through Azure AI Foundry.',
    portal: portal('https://ai.azure.com', {
      billing: 'https://portal.azure.com/#view/Microsoft_Azure_Billing/ModernBillingMenuBlade/~/Overview',
      docs: 'https://learn.microsoft.com/azure/ai-services/openai',
      status: 'https://status.azure.com'
    }),
    capabilities: capabilities({ balance: 'unsupported', status: 'manual' })
  },
  {
    id: 'google-gemini',
    title: 'Google Gemini',
    category: 'cloud',
    icon: builtinIcon('gemini'),
    description: 'Google AI Studio and Gemini API service.',
    defaultApiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    portal: portal('https://aistudio.google.com', {
      billing: 'https://console.cloud.google.com/billing',
      apiKeys: 'https://aistudio.google.com/apikey',
      docs: 'https://ai.google.dev/gemini-api/docs',
      status: 'https://status.cloud.google.com'
    }),
    capabilities: capabilities({ listModels: 'manual', status: 'manual' })
  },
  {
    id: 'aws-bedrock',
    title: 'AWS Bedrock',
    category: 'cloud',
    icon: builtinIcon('aws'),
    description: 'AWS Bedrock managed foundation model service.',
    portal: portal('https://console.aws.amazon.com/bedrock', {
      billing: 'https://console.aws.amazon.com/billing',
      docs: 'https://docs.aws.amazon.com/bedrock',
      status: 'https://health.aws.amazon.com/health/status'
    }),
    capabilities: capabilities({ balance: 'unsupported', status: 'manual' })
  },
  {
    id: 'openrouter',
    title: 'OpenRouter',
    category: 'relay',
    icon: builtinIcon('openrouter'),
    description: 'OpenRouter model routing platform with OpenAI-compatible APIs.',
    defaultApiBaseUrl: 'https://openrouter.ai/api/v1',
    portal: portal('https://openrouter.ai', {
      billing: 'https://openrouter.ai/settings/credits',
      apiKeys: 'https://openrouter.ai/settings/keys',
      docs: 'https://openrouter.ai/docs',
      status: 'https://status.openrouter.ai'
    }),
    capabilities: capabilities({ listModels: 'api', balance: 'manual', status: 'manual' })
  },
  {
    id: 'vercel-ai-gateway',
    title: 'Vercel AI Gateway',
    category: 'gateway',
    icon: builtinIcon('vercel'),
    description: 'Vercel AI Gateway for routing requests across model providers.',
    defaultApiBaseUrl: 'https://ai-gateway.vercel.sh/v1',
    portal: portal('https://vercel.com/ai-gateway', {
      billing: 'https://vercel.com/dashboard/usage',
      docs: 'https://vercel.com/docs/ai-gateway',
      status: 'https://www.vercel-status.com'
    }),
    capabilities: capabilities({ balance: 'manual', status: 'manual' })
  },
  {
    id: 'requesty',
    title: 'Requesty',
    category: 'relay',
    icon: builtinIcon('requesty'),
    description: 'Requesty AI gateway for OpenAI-compatible model routing.',
    defaultApiBaseUrl: 'https://router.requesty.ai/v1',
    portal: portal('https://requesty.ai', {
      billing: 'https://app.requesty.ai/billing',
      apiKeys: 'https://app.requesty.ai/api-keys',
      docs: 'https://docs.requesty.ai'
    }),
    capabilities: capabilities({ balance: 'manual', status: 'manual' })
  },
  {
    id: 'portkey',
    title: 'Portkey',
    category: 'gateway',
    icon: builtinIcon('portkey'),
    description: 'Portkey AI gateway for managing and routing model traffic.',
    defaultApiBaseUrl: 'https://api.portkey.ai/v1',
    portal: portal('https://portkey.ai', {
      billing: 'https://app.portkey.ai/billing',
      apiKeys: 'https://app.portkey.ai/api-keys',
      docs: 'https://portkey.ai/docs'
    }),
    capabilities: capabilities({ listModels: 'todo', balance: 'manual', status: 'manual' })
  },
  {
    id: 'litellm',
    title: 'LiteLLM',
    description: 'LiteLLM gateway and proxy for unified model APIs.',
    category: 'gateway',
    icon: builtinIcon('litellm'),
    portal: portal('https://www.litellm.ai', { docs: 'https://docs.litellm.ai' }),
    capabilities: capabilities({ balance: 'manual', status: 'manual' })
  },
  {
    id: 'micu',
    title: 'Micu',
    description: 'Micu relay platform for OpenAI-compatible model access.',
    category: 'relay',
    icon: builtinIcon('micu'),
    defaultApiBaseUrl: 'https://www.micuapi.ai/v1',
    portal: portal('https://www.micuapi.ai', { docs: 'https://docs.micuapi.ai' }),
    capabilities: capabilities({ listModels: 'manual', balance: 'api', status: 'manual' })
  },
  {
    id: 'apiyi',
    title: 'APIYI',
    description: 'APIYI relay platform for OpenAI-compatible model access.',
    category: 'relay',
    icon: builtinIcon('apiyi'),
    portal: portal('https://apiyi.com', { docs: 'https://apiyi.com' }),
    capabilities: capabilities({ listModels: 'manual', balance: 'manual', status: 'manual' })
  },
  {
    id: 'yunwu',
    title: 'Yunwu',
    description: 'Yunwu relay platform for OpenAI-compatible model access.',
    category: 'relay',
    icon: builtinIcon('yunwu'),
    portal: portal('https://yunwu.ai', { docs: 'https://yunwu.ai' }),
    capabilities: capabilities({ listModels: 'manual', balance: 'manual', status: 'manual' })
  },
  {
    id: 'custom-openai-compatible',
    title: 'Custom OpenAI-compatible',
    description: 'User-defined OpenAI-compatible endpoint.',
    category: 'custom',
    icon: builtinIcon('api'),
    capabilities: { listModels: 'todo', balance: 'unsupported', secrets: 'manual', status: 'unsupported' }
  }
] satisfies readonly ModelProviderDefinition[]
