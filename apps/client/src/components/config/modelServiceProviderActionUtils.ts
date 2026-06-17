import type {
  ConfigSource,
  ModelProviderCapabilities,
  ModelServiceConfig,
  ProviderAccountStatus,
  ProviderModelInfo,
  ProviderServiceStatus,
  ProviderStatusIndicator
} from '@oneworks/types'

import type { TranslationFn } from './configUtils'

export const toModelServiceConfig = (value: unknown): ModelServiceConfig => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as ModelServiceConfig
    : { apiKey: '' }
)

export const resolveProviderActionCapabilities = (
  capabilities: ModelProviderCapabilities | undefined,
  managementEnabled: boolean
) => ({
  canQueryModels: managementEnabled && (
    capabilities?.listModels === 'api' ||
    capabilities?.listModels === 'static'
  ),
  canQueryBalance: managementEnabled && capabilities?.balance === 'api',
  canQueryStatus: managementEnabled && capabilities?.status === 'api',
  canCreateSecret: managementEnabled && (
    capabilities?.secrets === 'api' ||
    capabilities?.secrets === 'manual'
  )
})

export const buildServiceActionFingerprint = (
  serviceKey: string,
  source: ConfigSource,
  service: ModelServiceConfig
) =>
  [
    serviceKey,
    source,
    service.provider,
    service.apiBaseUrl,
    service.apiKey,
    service.management?.apiKey
  ].join('\n')

export const normalizePortalUrl = (url: unknown) => {
  if (typeof url !== 'string' || url.trim() === '') return undefined
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol === 'https:') return parsed.toString()
    const isLocalHttp = parsed.protocol === 'http:' && (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]'
    )
    return isLocalHttp ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

export const openExternalUrl = async (url: string) => {
  const normalizedUrl = normalizePortalUrl(url)
  if (normalizedUrl == null) {
    throw new Error('Invalid model service portal URL.')
  }
  if (window.oneworksDesktop?.openExternalUrl != null) {
    await window.oneworksDesktop.openExternalUrl(normalizedUrl)
    return
  }
  window.open(normalizedUrl, '_blank', 'noopener,noreferrer')
}

export const normalizeProviderModels = (models: ProviderModelInfo[]) => (
  Array.from(new Set(models.map(model => model.id.trim()).filter(Boolean)))
)

export const formatBalance = (account: ProviderAccountStatus | null, t: TranslationFn) => {
  if (account == null) return undefined
  if (account.kind === 'unsupported') return account.reason
  if (account.kind === 'quota') {
    const amount = account.remaining == null || account.limit == null
      ? account.remaining ?? account.limit ?? t('config.modelServices.results.amountUnknown')
      : `${account.remaining}/${account.limit}`
    const reset = account.resetTime == null
      ? undefined
      : t('config.modelServices.results.resetsAt', { time: account.resetTime })
    const window = account.windows?.[0]
    const windowAmount = window?.remaining == null || window.limit == null
      ? undefined
      : t('config.modelServices.results.windowQuota', {
        amount: `${window.remaining}/${window.limit}`,
        duration: [window.duration, window.timeUnit].filter(Boolean).join(' ')
      })
    const parallel = account.parallelLimit == null
      ? undefined
      : t('config.modelServices.results.parallelLimit', { count: account.parallelLimit })
    return [amount, reset, windowAmount, parallel].filter(Boolean).join(' · ')
  }
  if (account.kind === 'cost') {
    const amount = account.amount == null ? t('config.modelServices.results.amountUnknown') : String(account.amount)
    return [account.currency, amount, account.period].filter(Boolean).join(' ')
  }
  const available = account.available == null
    ? t('config.modelServices.results.amountUnknown')
    : String(account.available)
  return [account.currency, available].filter(Boolean).join(' ')
}

export const getAccountStatusLabel = (account: ProviderAccountStatus, t: TranslationFn) => (
  account.kind === 'quota'
    ? t('config.modelServices.results.quota')
    : t('config.modelServices.results.balance')
)

export const formatStatus = (status: ProviderServiceStatus | null, t: TranslationFn) => {
  if (status == null) return undefined
  return status.description ?? t(`config.modelServices.status.${status.indicator}`, {
    defaultValue: status.indicator
  })
}

export const statusClassName = (indicator: ProviderStatusIndicator | undefined) => (
  `config-view__model-service-status config-view__model-service-status--${indicator ?? 'unknown'}`
)
