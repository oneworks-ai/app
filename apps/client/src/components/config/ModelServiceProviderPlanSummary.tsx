import { Button } from 'antd'

import type { ModelServiceConfig } from '@oneworks/types'
import {
  resolveModelServiceBilling,
  resolveModelServiceCodingPlan,
  resolveModelServicePlanProtocolBaseUrl
} from '@oneworks/utils/model-providers'

import type { TranslationFn } from './configUtils'
import { normalizePortalUrl } from './modelServiceProviderActionUtils'

const translatePlanValue = (t: TranslationFn, namespace: string, value: string | undefined) => (
  value == null ? undefined : t(`config.modelServices.plan.${namespace}.${value}`, { defaultValue: value })
)

const formatQuota = (service: ModelServiceConfig, t: TranslationFn) => {
  const billing = resolveModelServiceBilling(service)
  const quotaUnit = translatePlanValue(t, 'quotaUnit', billing?.quotaUnit)
  const windows = billing?.quotaWindows?.map(window => translatePlanValue(t, 'quotaWindow', window) ?? window)
  return [quotaUnit, windows?.join(' / ')].filter(Boolean).join(' · ')
}

const uniqueLinks = (
  links: Array<{ label: string; url: string | undefined }>
) => {
  const seen = new Set<string>()
  return links.flatMap((link) => {
    const url = normalizePortalUrl(link.url)
    if (url == null || seen.has(url)) return []
    seen.add(url)
    return [{ ...link, url }]
  })
}

export const ModelServiceProviderPlanSummary = ({
  onOpen,
  service,
  t
}: {
  onOpen: (url: string, title?: string) => void
  service: ModelServiceConfig
  t: TranslationFn
}) => {
  const billing = resolveModelServiceBilling(service)
  const plan = resolveModelServiceCodingPlan(service)
  if (plan == null && billing?.kind == null) return null

  const openaiBaseUrl = resolveModelServicePlanProtocolBaseUrl(service, 'openai')
  const anthropicBaseUrl = resolveModelServicePlanProtocolBaseUrl(service, 'anthropic')
  const links = uniqueLinks([
    { label: t('config.modelServices.plan.links.purchase'), url: plan?.planHomeUrl },
    { label: t('config.modelServices.plan.links.key'), url: plan?.keyHomeUrl },
    { label: t('config.modelServices.plan.links.docs'), url: plan?.docsUrl }
  ])
  const quota = formatQuota(service, t)
  const metadata = [
    {
      label: t('config.modelServices.plan.labels.kind'),
      value: translatePlanValue(t, 'kind', billing?.kind ?? plan?.kind)
    },
    {
      label: t('config.modelServices.plan.labels.keyKind'),
      value: translatePlanValue(t, 'keyKind', billing?.keyKind)
    },
    {
      label: t('config.modelServices.plan.labels.quota'),
      value: quota === '' ? undefined : quota
    },
    {
      label: t('config.modelServices.plan.labels.allowedUse'),
      value: translatePlanValue(t, 'allowedUse', billing?.allowedUse)
    }
  ].filter((entry): entry is { label: string; value: string } => entry.value != null && entry.value !== '')
  const endpoints = [
    { label: 'OpenAI', value: openaiBaseUrl },
    { label: 'Anthropic', value: anthropicBaseUrl }
  ].filter((entry): entry is { label: string; value: string } => entry.value != null)
  const models = plan?.defaultModels ?? []
  const restrictions = plan?.restrictions ?? []

  return (
    <div className='config-view__model-service-plan'>
      <div className='config-view__model-service-plan-header'>
        <span className='material-symbols-rounded'>workspace_premium</span>
        <strong>{plan?.title ?? t('config.modelServices.plan.title')}</strong>
      </div>
      {metadata.length > 0 && (
        <div className='config-view__model-service-plan-grid'>
          {metadata.map(entry => (
            <div className='config-view__model-service-plan-row' key={entry.label}>
              <span>{entry.label}</span>
              <strong>{entry.value}</strong>
            </div>
          ))}
        </div>
      )}
      {endpoints.length > 0 && (
        <div className='config-view__model-service-plan-endpoints'>
          {endpoints.map(endpoint => (
            <div className='config-view__model-service-plan-endpoint' key={endpoint.label}>
              <span>{endpoint.label}</span>
              <code>{endpoint.value}</code>
            </div>
          ))}
        </div>
      )}
      {models.length > 0 && (
        <div className='config-view__model-service-plan-models'>
          <span>{t('config.modelServices.plan.labels.defaultModels')}</span>
          <div className='config-view__model-service-model-list'>
            {models.slice(0, 10).map(model => <code key={model}>{model}</code>)}
            {models.length > 10 && (
              <code>{t('config.modelServices.results.modelsMore', { count: models.length - 10 })}</code>
            )}
          </div>
        </div>
      )}
      {restrictions.map(restriction => (
        <div className='config-view__model-service-warning' key={restriction}>{restriction}</div>
      ))}
      {links.length > 0 && (
        <div className='config-view__model-service-plan-links'>
          {links.map(link => (
            <Button
              key={link.url}
              size='small'
              type='text'
              icon={<span className='material-symbols-rounded'>open_in_browser</span>}
              onClick={() => onOpen(link.url, link.label)}
            >
              {link.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
