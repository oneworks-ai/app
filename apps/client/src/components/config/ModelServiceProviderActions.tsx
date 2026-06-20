/* eslint-disable max-lines -- provider actions coordinate portal, API actions, live quota, and result rendering. */
import { App } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ConfigSource, ProviderAccountStatus, ProviderModelInfo, ProviderServiceStatus } from '@oneworks/types'
import {
  getModelProviderDefinition,
  resolveModelProviderIdentity,
  resolveModelServiceBilling,
  resolveModelServiceCodingPlan,
  resolveModelServiceHomepageUrl
} from '@oneworks/utils/model-providers'

import {
  createModelServiceSecret,
  getApiErrorMessage,
  getModelServiceBalance,
  getModelServiceStatus,
  listModelServiceModels
} from '#~/api'

import {
  ModelServiceProviderActionButtons,
  ModelServiceProviderActionHeader
} from './ModelServiceProviderActionContent'
import type { ModelServiceProviderMoreAction } from './ModelServiceProviderActionContent'
import { ModelServiceProviderActionResults } from './ModelServiceProviderActionResults'
import { ModelServiceProviderPlanSummary, getModelServicePlanLinks } from './ModelServiceProviderPlanSummary'
import type { ModelServiceProviderPortalRequest } from './ModelServiceProviderPortalBottomPanel'
import type { TranslationFn } from './configUtils'
import {
  getCachedModelServiceAccountStatus,
  setCachedModelServiceAccountStatus
} from './modelServiceAccountStatusCache'
import {
  buildServiceActionFingerprint,
  normalizePortalUrl,
  normalizeProviderModels,
  openExternalUrl,
  resolveProviderActionCapabilities,
  toModelServiceConfig
} from './modelServiceProviderActionUtils'

export const ModelServiceProviderActions = ({
  item,
  onOpenPortal,
  serviceKey,
  source,
  t
}: {
  item: unknown
  onOpenPortal?: (request: ModelServiceProviderPortalRequest) => void
  serviceKey: string
  source: ConfigSource
  t: TranslationFn
}) => {
  const { message } = App.useApp()
  const service = useMemo(() => toModelServiceConfig(item), [item])
  const identity = resolveModelProviderIdentity(service)
  const provider = identity.provider == null ? undefined : getModelProviderDefinition(identity.provider)
  const providerTitle = provider?.title ?? identity.provider ?? t('config.options.modelProviders.custom')
  const homepageUrl = normalizePortalUrl(resolveModelServiceHomepageUrl(service))
  const billing = resolveModelServiceBilling(service)
  const codingPlan = resolveModelServiceCodingPlan(service)
  const managementEnabled = service.management?.enabled !== false
  const providerCapabilities = provider?.capabilities
  const actionCapabilities = resolveProviderActionCapabilities(providerCapabilities, managementEnabled)
  const hasAutomaticModelCatalog = (codingPlan?.defaultModels?.length ?? 0) > 0 ||
    (provider?.defaultModels?.length ?? 0) > 0
  const secretActionLabel = providerCapabilities?.secrets === 'manual'
    ? t('config.modelServices.actions.openApiKeys')
    : t('config.modelServices.actions.createSecret')
  const [loadingAction, setLoadingAction] = useState<string>()
  const [models, setModels] = useState<ProviderModelInfo[]>([])
  const [accountStatus, setAccountStatus] = useState<ProviderAccountStatus | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [serviceStatus, setServiceStatus] = useState<ProviderServiceStatus | null>(null)
  const autoBalanceFingerprintRef = useRef<string | null>(null)

  const modelIds = useMemo(() => normalizeProviderModels(models), [models])
  const serviceFingerprint = buildServiceActionFingerprint(serviceKey, source, service)
  const showsPlanSummary = codingPlan != null || billing?.kind != null
  const shouldShowAccountSummary = showsPlanSummary || actionCapabilities.canQueryBalance
  const canAutoQueryAccountStatus = shouldShowAccountSummary && actionCapabilities.canQueryBalance

  useEffect(() => {
    const cachedAccountStatus = getCachedModelServiceAccountStatus(serviceFingerprint)
    setModels([])
    setAccountStatus(cachedAccountStatus)
    setAccountError(null)
    setServiceStatus(null)
  }, [serviceFingerprint])

  const runAction = useCallback(async <T,>(
    actionKey: string,
    action: () => Promise<T>,
    options?: { silent?: boolean }
  ) => {
    setLoadingAction(actionKey)
    try {
      return await action()
    } catch (error) {
      if (options?.silent !== true) {
        void message.error(getApiErrorMessage(error, t('config.modelServices.results.actionFailed')))
      }
      return undefined
    } finally {
      setLoadingAction(undefined)
    }
  }, [message, t])

  const handleOpenExternal = useCallback(async (url: string) => (
    await runAction('external', async () => openExternalUrl(url))
  ), [runAction])

  const openPortal = useCallback((url: string, title = providerTitle) => {
    const normalizedUrl = normalizePortalUrl(url)
    if (normalizedUrl == null) return
    onOpenPortal?.({
      title,
      url: normalizedUrl
    })
  }, [onOpenPortal, providerTitle])

  const handleListModels = async () => {
    const result = await runAction('models', () => listModelServiceModels(serviceKey, { service, source }))
    if (result == null) return undefined
    setModels(result.models)
    void message.success(t('config.modelServices.results.modelsLoaded', { count: result.models.length }))
    return result.models
  }

  const handleBalance = useCallback(async (options?: { silent?: boolean }) => {
    setAccountError(null)
    const result = await runAction(
      'balance',
      () => getModelServiceBalance(serviceKey, { service, source }),
      options
    )
    if (result == null) {
      setAccountError(t('config.modelServices.plan.liveQuota.failed'))
      return
    }
    setCachedModelServiceAccountStatus(serviceFingerprint, result.account)
    setAccountStatus(result.account)
  }, [runAction, service, serviceFingerprint, serviceKey, source, t])

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

  useEffect(() => {
    if (!canAutoQueryAccountStatus) return
    const cachedAccountStatus = getCachedModelServiceAccountStatus(serviceFingerprint)
    if (cachedAccountStatus != null) {
      setAccountStatus(cachedAccountStatus)
      setAccountError(null)
      return
    }
    if (autoBalanceFingerprintRef.current === serviceFingerprint) return
    autoBalanceFingerprintRef.current = serviceFingerprint
    void handleBalance({ silent: true })
  }, [canAutoQueryAccountStatus, handleBalance, serviceFingerprint])

  const moreActions: ModelServiceProviderMoreAction[] = [
    ...(!shouldShowAccountSummary && actionCapabilities.canQueryBalance
      ? [{
        icon: 'account_balance_wallet',
        key: 'balance',
        label: t('config.modelServices.actions.queryBalance'),
        onClick: () => void handleBalance()
      }]
      : []),
    ...(actionCapabilities.canQueryStatus
      ? [{
        icon: 'cloud_sync',
        key: 'status',
        label: t('config.modelServices.actions.queryStatus'),
        onClick: () => void handleStatus()
      }]
      : []),
    ...(!hasAutomaticModelCatalog && actionCapabilities.canQueryModels
      ? [{
        icon: 'view_list',
        key: 'models',
        label: t('config.modelServices.actions.queryModels'),
        onClick: () => void handleListModels()
      }]
      : []),
    ...getModelServicePlanLinks({ service, t }).map(link => ({
      icon: 'open_in_browser',
      key: `plan:${link.url}`,
      label: link.label,
      onClick: () => openPortal(link.url, link.label)
    })),
    ...(homepageUrl == null ? [] : [{
      icon: 'open_in_new',
      key: `external:${homepageUrl}`,
      label: t('config.modelServices.actions.openExternal'),
      onClick: () => void handleOpenExternal(homepageUrl)
    }])
  ]

  return (
    <div className='config-view__model-service-actions'>
      <ModelServiceProviderActionHeader
        headerActions={
          <ModelServiceProviderActionButtons
            canCreateSecret={actionCapabilities.canCreateSecret}
            homepageUrl={homepageUrl}
            loadingAction={loadingAction}
            onHomepage={openPortal}
            onSecret={() => void handleSecret()}
            secretActionLabel={secretActionLabel}
            t={t}
          />
        }
        moreActions={moreActions}
        providerTitle={providerTitle}
        service={service}
        serviceStatus={serviceStatus}
        t={t}
      />
      <ModelServiceProviderPlanSummary
        accountError={accountError}
        accountStatus={accountStatus}
        canQueryBalance={actionCapabilities.canQueryBalance}
        loadingBalance={loadingAction === 'balance'}
        service={service}
        t={t}
      />
      <ModelServiceProviderActionResults
        accountStatus={shouldShowAccountSummary ? null : accountStatus}
        identity={identity}
        models={models}
        serviceStatus={serviceStatus}
        t={t}
      />
    </div>
  )
}
