import { Button, Tooltip } from 'antd'

import type { ModelProviderIdentity, ModelServiceConfig, ProviderServiceStatus } from '@oneworks/types'
import { resolveModelServiceIcon } from '@oneworks/utils/model-providers'

import { renderIconRef } from '#~/utils/model-provider-icons'

import type { TranslationFn } from './configUtils'
import { statusClassName } from './modelServiceProviderActionUtils'

export const ModelServiceProviderActionHeader = ({
  identity,
  providerTitle,
  service,
  serviceStatus,
  t
}: {
  identity: ModelProviderIdentity
  providerTitle: string
  service: ModelServiceConfig
  serviceStatus: ProviderServiceStatus | null
  t: TranslationFn
}) => (
  <div className='config-view__model-service-action-header'>
    <div className='config-view__model-service-action-title'>
      {renderIconRef({
        icon: resolveModelServiceIcon(service),
        imageClassName: 'config-view__model-service-action-icon',
        symbolClassName: 'config-view__model-service-action-icon'
      })}
      <div className='config-view__model-service-action-title-text'>
        <div>{providerTitle}</div>
        <div className='config-view__model-service-action-subtitle'>
          {identity.confidence === 'configured'
            ? t('config.modelServices.identity.configured')
            : identity.confidence === 'host_match'
            ? t('config.modelServices.identity.hostMatch')
            : t('config.modelServices.identity.custom')}
        </div>
      </div>
    </div>
    {serviceStatus != null && (
      <span className={statusClassName(serviceStatus.indicator)}>
        {t(`config.modelServices.status.${serviceStatus.indicator}`, {
          defaultValue: serviceStatus.indicator
        })}
      </span>
    )}
  </div>
)

export const ModelServiceProviderActionButtons = ({
  canCreateSecret,
  canQueryBalance,
  canQueryModels,
  canQueryStatus,
  canRefreshModels,
  homepageUrl,
  loadingAction,
  onBalance,
  onExternal,
  onHomepage,
  onListModels,
  onRefreshModels,
  onSecret,
  onStatus,
  secretActionLabel,
  t
}: {
  canCreateSecret: boolean
  canRefreshModels: boolean
  canQueryBalance: boolean
  canQueryModels: boolean
  canQueryStatus: boolean
  homepageUrl?: string
  loadingAction?: string
  onBalance: () => void
  onExternal: (url: string) => void
  onHomepage: (url: string) => void
  onListModels: () => void
  onRefreshModels: () => void
  onSecret: () => void
  onStatus: () => void
  secretActionLabel: string
  t: TranslationFn
}) => (
  <div className='config-view__model-service-action-buttons'>
    {homepageUrl != null && (
      <>
        <Button
          size='small'
          icon={<span className='material-symbols-rounded'>web_asset</span>}
          onClick={() => onHomepage(homepageUrl)}
        >
          {t('config.modelServices.actions.openHomepage')}
        </Button>
        <Tooltip title={t('config.modelServices.actions.openExternal')}>
          <Button
            size='small'
            type='text'
            aria-label={t('config.modelServices.actions.openExternal')}
            icon={<span className='material-symbols-rounded'>open_in_new</span>}
            loading={loadingAction === 'external'}
            onClick={() => onExternal(homepageUrl)}
          />
        </Tooltip>
      </>
    )}
    <Button
      size='small'
      icon={<span className='material-symbols-rounded'>vpn_key</span>}
      disabled={!canCreateSecret}
      loading={loadingAction === 'secret'}
      onClick={onSecret}
    >
      {secretActionLabel}
    </Button>
    <Button
      size='small'
      icon={<span className='material-symbols-rounded'>account_balance_wallet</span>}
      disabled={!canQueryBalance}
      loading={loadingAction === 'balance'}
      onClick={onBalance}
    >
      {t('config.modelServices.actions.queryBalance')}
    </Button>
    <Button
      size='small'
      icon={<span className='material-symbols-rounded'>cloud_sync</span>}
      disabled={!canQueryStatus}
      loading={loadingAction === 'status'}
      onClick={onStatus}
    >
      {t('config.modelServices.actions.queryStatus')}
    </Button>
    <Button
      size='small'
      icon={<span className='material-symbols-rounded'>view_list</span>}
      disabled={!canQueryModels}
      loading={loadingAction === 'models'}
      onClick={onListModels}
    >
      {t('config.modelServices.actions.queryModels')}
    </Button>
    <Button
      size='small'
      type={canRefreshModels ? 'primary' : 'default'}
      disabled={!canRefreshModels}
      icon={<span className='material-symbols-rounded'>download_done</span>}
      loading={loadingAction === 'refreshModels'}
      onClick={onRefreshModels}
    >
      {t('config.modelServices.actions.refreshModels')}
    </Button>
  </div>
)
