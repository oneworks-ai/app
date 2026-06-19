import { Button, Dropdown, Tooltip } from 'antd'
import type { ReactNode } from 'react'

import type { ModelServiceConfig, ProviderServiceStatus } from '@oneworks/types'
import { resolveModelServiceIcon } from '@oneworks/utils/model-providers'

import { renderIconRef } from '#~/utils/model-provider-icons'

import type { TranslationFn } from './configUtils'
import { statusClassName } from './modelServiceProviderActionUtils'

export interface ModelServiceProviderMoreAction {
  icon: string
  key: string
  label: string
  onClick: () => void
}

export const ModelServiceProviderActionHeader = ({
  headerActions,
  moreActions = [],
  providerTitle,
  service,
  serviceStatus,
  t
}: {
  headerActions?: ReactNode
  moreActions?: ModelServiceProviderMoreAction[]
  providerTitle: string
  service: ModelServiceConfig
  serviceStatus: ProviderServiceStatus | null
  t: TranslationFn
}) => {
  const moreMenuItems = moreActions.map(action => ({
    icon: <span className='material-symbols-rounded'>{action.icon}</span>,
    key: action.key,
    label: action.label
  }))

  return (
    <div className='config-view__model-service-action-header'>
      <div className='config-view__model-service-action-title'>
        {renderIconRef({
          icon: resolveModelServiceIcon(service),
          imageClassName: 'config-view__model-service-action-icon',
          symbolClassName: 'config-view__model-service-action-icon'
        })}
        <div className='config-view__model-service-action-title-text'>
          <div>{providerTitle}</div>
        </div>
      </div>
      <div className='config-view__model-service-action-header-actions'>
        {headerActions}
        {serviceStatus != null && (
          <span className={statusClassName(serviceStatus.indicator)}>
            {t(`config.modelServices.status.${serviceStatus.indicator}`, {
              defaultValue: serviceStatus.indicator
            })}
          </span>
        )}
        {moreActions.length > 0 && (
          <Tooltip title={t('config.modelServices.actions.more')}>
            <Dropdown
              trigger={['click']}
              placement='bottomRight'
              menu={{
                items: moreMenuItems,
                onClick: ({ key }) => {
                  moreActions.find(action => action.key === key)?.onClick()
                }
              }}
            >
              <Button
                className='config-view__model-service-more-button'
                size='small'
                type='text'
                aria-label={t('config.modelServices.actions.more')}
                icon={<span className='material-symbols-rounded'>more_horiz</span>}
              />
            </Dropdown>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

export const ModelServiceProviderActionButtons = ({
  canCreateSecret,
  canRefreshModels,
  homepageUrl,
  loadingAction,
  onHomepage,
  onRefreshModels,
  onSecret,
  secretActionLabel,
  t
}: {
  canCreateSecret: boolean
  canRefreshModels: boolean
  homepageUrl?: string
  loadingAction?: string
  onHomepage: (url: string) => void
  onRefreshModels: () => void
  onSecret: () => void
  secretActionLabel: string
  t: TranslationFn
}) => {
  if (homepageUrl == null && !canCreateSecret && !canRefreshModels) return null

  return (
    <div className='config-view__model-service-action-buttons'>
      {homepageUrl != null && (
        <Tooltip title={t('config.modelServices.actions.openHomepage')}>
          <Button
            size='small'
            aria-label={t('config.modelServices.actions.openHomepage')}
            icon={<span className='material-symbols-rounded'>web_asset</span>}
            onClick={() => onHomepage(homepageUrl)}
          />
        </Tooltip>
      )}
      {canCreateSecret && (
        <Tooltip title={secretActionLabel}>
          <Button
            size='small'
            aria-label={secretActionLabel}
            icon={<span className='material-symbols-rounded'>vpn_key</span>}
            loading={loadingAction === 'secret'}
            onClick={onSecret}
          />
        </Tooltip>
      )}
      {canRefreshModels && (
        <Tooltip title={t('config.modelServices.actions.refreshModels')}>
          <Button
            size='small'
            type='primary'
            aria-label={t('config.modelServices.actions.refreshModels')}
            icon={<span className='material-symbols-rounded'>download_done</span>}
            loading={loadingAction === 'refreshModels'}
            onClick={onRefreshModels}
          />
        </Tooltip>
      )}
    </div>
  )
}
