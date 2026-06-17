/* eslint-disable max-lines -- official provider catalog keeps service metadata in one registry */
import type {
  IconRef,
  ModelProviderCapabilities,
  ModelProviderDefinition,
  ModelProviderPortalLinks
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
    portal: portal('https://micu.hk', { docs: 'https://micu.hk' }),
    capabilities: capabilities({ listModels: 'manual', balance: 'manual', status: 'manual' })
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
