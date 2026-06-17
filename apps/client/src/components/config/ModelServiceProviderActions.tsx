import { App } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import type { ConfigSource, ProviderAccountStatus, ProviderModelInfo, ProviderServiceStatus } from '@oneworks/types'
import {
  getModelProviderDefinition,
  resolveModelProviderIdentity,
  resolveModelServiceHomepageUrl
} from '@oneworks/utils/model-providers'

import {
  createModelServiceSecret,
  getApiErrorMessage,
  getModelServiceBalance,
  getModelServiceStatus,
  listModelServiceModels,
  refreshModelServiceModels
} from '#~/api'

import {
  ModelServiceProviderActionButtons,
  ModelServiceProviderActionHeader
} from './ModelServiceProviderActionContent'
import { ModelServiceProviderActionResults } from './ModelServiceProviderActionResults'
import { ModelServiceProviderPlanSummary } from './ModelServiceProviderPlanSummary'
import { ModelServiceProviderPortal } from './ModelServiceProviderPortal'
import type { TranslationFn } from './configUtils'
import {
  buildServiceActionFingerprint,
  normalizePortalUrl,
  normalizeProviderModels,
  openExternalUrl,
  resolveProviderActionCapabilities,
  toModelServiceConfig
} from './modelServiceProviderActionUtils'

export const ModelServiceProviderActions = ({
  canRefreshModels = true,
  item,
  onChange,
  serviceKey,
  source,
  t
}: {
  canRefreshModels?: boolean
  item: unknown
  onChange: (nextItem: Record<string, unknown>) => void
  serviceKey: string
  source: ConfigSource
  t: TranslationFn
}) => {
  const { message } = App.useApp()
  const service = toModelServiceConfig(item)
  const identity = resolveModelProviderIdentity(service)
  const provider = identity.provider == null ? undefined : getModelProviderDefinition(identity.provider)
  const providerTitle = provider?.title ?? identity.provider ?? t('config.options.modelProviders.custom')
  const homepageUrl = normalizePortalUrl(resolveModelServiceHomepageUrl(service))
  const managementEnabled = service.management?.enabled !== false
  const providerCapabilities = provider?.capabilities
  const actionCapabilities = resolveProviderActionCapabilities(providerCapabilities, managementEnabled)
  const secretActionLabel = providerCapabilities?.secrets === 'manual'
    ? t('config.modelServices.actions.openApiKeys')
    : t('config.modelServices.actions.createSecret')
  const [portalUrl, setPortalUrl] = useState<string>()
  const [portalTitle, setPortalTitle] = useState(providerTitle)
  const [loadingAction, setLoadingAction] = useState<string>()
  const [models, setModels] = useState<ProviderModelInfo[]>([])
  const [accountStatus, setAccountStatus] = useState<ProviderAccountStatus | null>(null)
  const [serviceStatus, setServiceStatus] = useState<ProviderServiceStatus | null>(null)

  const modelIds = useMemo(() => normalizeProviderModels(models), [models])
  const serviceFingerprint = buildServiceActionFingerprint(serviceKey, source, service)

  useEffect(() => {
    setModels([])
    setAccountStatus(null)
    setServiceStatus(null)
  }, [serviceFingerprint])

  const runAction = async <T,>(actionKey: string, action: () => Promise<T>) => {
    setLoadingAction(actionKey)
    try {
      return await action()
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.modelServices.results.actionFailed')))
      return undefined
    } finally {
      setLoadingAction(undefined)
    }
  }

  const openPortal = (url: string, title = providerTitle) => {
    setPortalUrl(url)
    setPortalTitle(title)
  }

  const handleOpenExternal = async (url: string) => await runAction('external', async () => openExternalUrl(url))

  const handleListModels = async () => {
    const result = await runAction('models', () => listModelServiceModels(serviceKey, { service, source }))
    if (result == null) return undefined
    setModels(result.models)
    void message.success(t('config.modelServices.results.modelsLoaded', { count: result.models.length }))
    return result.models
  }

  const handleRefreshModels = async () => {
    const nextModels = modelIds.length > 0 ? models : await handleListModels()
    const nextModelIds = normalizeProviderModels(nextModels ?? [])
    if (nextModelIds.length === 0) {
      void message.warning(t('config.modelServices.results.modelsEmpty'))
      return
    }

    const result = await runAction('refreshModels', () =>
      refreshModelServiceModels({
        models: nextModelIds,
        service,
        serviceKey,
        source
      }))
    if (result == null) return
    onChange({ ...toModelServiceConfig(item), models: result.models })
    void message.success(t('config.modelServices.results.modelsRefreshed', { count: result.models.length }))
  }

  const handleBalance = async () => {
    const result = await runAction('balance', () => getModelServiceBalance(serviceKey, { service, source }))
    if (result == null) return
    setAccountStatus(result.account)
  }

  const handleStatus = async () => {
    const result = await runAction('status', () => getModelServiceStatus(serviceKey, { service, source }))
    if (result == null) return
    setServiceStatus(result.status)
  }

  const handleSecret = async () => {
    const result = await runAction('secret', () => createModelServiceSecret(serviceKey, { service, source }))
    if (result == null) return
    const secret = result.secret
    if (secret.kind === 'console') {
      openPortal(secret.url, t('config.modelServices.portal.secretTitle', { provider: providerTitle }))
      return
    }
    if (secret.kind === 'created') {
      void navigator.clipboard?.writeText(secret.value)
      void message.success(t('config.modelServices.results.secretCreated'))
      return
    }
    void message.info(secret.reason)
  }

  return (
    <div className='config-view__model-service-actions'>
      <ModelServiceProviderActionHeader
        identity={identity}
        providerTitle={providerTitle}
        service={service}
        serviceStatus={serviceStatus}
        t={t}
      />
      <ModelServiceProviderPlanSummary onOpen={openPortal} service={service} t={t} />
      <ModelServiceProviderActionButtons
        canCreateSecret={actionCapabilities.canCreateSecret}
        homepageUrl={homepageUrl}
        loadingAction={loadingAction}
        canQueryBalance={actionCapabilities.canQueryBalance}
        canQueryModels={actionCapabilities.canQueryModels}
        canQueryStatus={actionCapabilities.canQueryStatus}
        canRefreshModels={canRefreshModels && managementEnabled}
        onBalance={() => void handleBalance()}
        onExternal={(url) => void handleOpenExternal(url)}
        onHomepage={openPortal}
        onListModels={() => void handleListModels()}
        onRefreshModels={() => void handleRefreshModels()}
        onSecret={() => void handleSecret()}
        onStatus={() => void handleStatus()}
        secretActionLabel={secretActionLabel}
        t={t}
      />
      <ModelServiceProviderActionResults
        accountStatus={accountStatus}
        identity={identity}
        models={models}
        serviceStatus={serviceStatus}
        t={t}
      />
      <ModelServiceProviderPortal
        url={portalUrl}
        title={portalTitle}
        t={t}
        onClose={() => setPortalUrl(undefined)}
        onOpenExternal={(url) => void handleOpenExternal(url)}
      />
    </div>
  )
}
