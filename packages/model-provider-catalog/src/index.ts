import type { ModelProviderCatalog, ModelProviderDefinition, ModelProviderHostMatcher } from '@oneworks/types'

import { MODEL_PROVIDER_DEFINITIONS } from './catalog'

export { MODEL_PROVIDER_DEFINITIONS } from './catalog'

export const MODEL_PROVIDER_CATALOG_SCHEMA_VERSION = 1 as const

export const MODEL_PROVIDER_HOST_MATCHERS = [
  { provider: 'openai', hosts: ['api.openai.com'] },
  { provider: 'anthropic', hosts: ['api.anthropic.com'] },
  { provider: 'moonshot-cn', hosts: ['api.moonshot.cn'] },
  { provider: 'moonshot-intl', hosts: ['api.moonshot.ai'] },
  { provider: 'kimi-code', hosts: ['api.kimi.com'], pathPrefix: '/coding' },
  { provider: 'deepseek', hosts: ['api.deepseek.com'] },
  {
    provider: 'minimax-token-plan',
    hosts: ['api.minimax.io', 'api.minimaxi.com'],
    pathPrefix: '/anthropic'
  },
  { provider: 'minimax', hosts: ['api.minimax.io', 'api.minimaxi.com'] },
  {
    provider: 'qwen-coding-plan',
    hosts: ['coding.dashscope.aliyuncs.com', 'coding-intl.dashscope.aliyuncs.com']
  },
  {
    provider: 'qwen',
    hosts: [
      'dashscope.aliyuncs.com',
      'dashscope-intl.aliyuncs.com',
      'dashscope-us.aliyuncs.com',
      '*.dashscope.aliyuncs.com',
      '*.maas.aliyuncs.com'
    ]
  },
  { provider: 'zhipu-coding-plan', hosts: ['open.bigmodel.cn'], pathPrefix: '/api/coding' },
  { provider: 'zhipu', hosts: ['open.bigmodel.cn'] },
  {
    provider: 'tencent-tokenhub-coding-plan',
    hosts: ['api.lkeap.cloud.tencent.com'],
    pathPrefix: '/coding'
  },
  {
    provider: 'volcengine-ark-coding-plan',
    hosts: ['ark.cn-beijing.volces.com'],
    pathPrefix: '/api/coding'
  },
  {
    provider: 'baidu-qianfan-coding-plan',
    hosts: ['qianfan.baidubce.com'],
    pathIncludes: '/coding'
  },
  { provider: 'openrouter', hosts: ['openrouter.ai'] },
  { provider: 'vercel-ai-gateway', hosts: ['ai-gateway.vercel.sh'] },
  { provider: 'requesty', hosts: ['router.requesty.ai'] },
  { provider: 'portkey', hosts: ['api.portkey.ai'] }
] satisfies readonly ModelProviderHostMatcher[]

export const MODEL_PROVIDER_CATALOG: ModelProviderCatalog = {
  schemaVersion: MODEL_PROVIDER_CATALOG_SCHEMA_VERSION,
  providers: MODEL_PROVIDER_DEFINITIONS,
  hostMatchers: MODEL_PROVIDER_HOST_MATCHERS
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim() !== ''
)

const isProviderDefinition = (value: unknown): value is ModelProviderDefinition => {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.title) && isNonEmptyString(value.category)
}

const isHostMatcher = (value: unknown): value is ModelProviderHostMatcher => {
  if (!isRecord(value) || !isNonEmptyString(value.provider) || !Array.isArray(value.hosts)) return false
  return value.hosts.length > 0 && value.hosts.every(isNonEmptyString) &&
    (value.pathPrefix == null || isNonEmptyString(value.pathPrefix)) &&
    (value.pathIncludes == null || isNonEmptyString(value.pathIncludes))
}

export const validateModelProviderCatalog = (value: unknown): ModelProviderCatalog => {
  if (!isRecord(value) || value.schemaVersion !== MODEL_PROVIDER_CATALOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported model provider catalog schema; expected ${MODEL_PROVIDER_CATALOG_SCHEMA_VERSION}.`)
  }
  if (!Array.isArray(value.providers) || !value.providers.every(isProviderDefinition)) {
    throw new Error('Model provider catalog contains invalid provider definitions.')
  }
  if (!Array.isArray(value.hostMatchers) || !value.hostMatchers.every(isHostMatcher)) {
    throw new Error('Model provider catalog contains invalid host matchers.')
  }

  const providerIds = new Set<string>()
  for (const provider of value.providers) {
    if (providerIds.has(provider.id)) throw new Error(`Duplicate model provider id: ${provider.id}`)
    providerIds.add(provider.id)
  }
  for (const matcher of value.hostMatchers) {
    if (!providerIds.has(matcher.provider)) {
      throw new Error(`Model provider host matcher references unknown provider: ${matcher.provider}`)
    }
  }

  return value as unknown as ModelProviderCatalog
}
