import type {
  ModelProviderIdentity,
  ProviderAccountStatus,
  ProviderModelInfo,
  ProviderServiceStatus
} from '@oneworks/types'

import type { TranslationFn } from './configUtils'
import { formatBalance, formatStatus, normalizeProviderModels } from './modelServiceProviderActionUtils'

export const ModelServiceProviderActionResults = ({
  accountStatus,
  identity,
  models,
  serviceStatus,
  t
}: {
  accountStatus: ProviderAccountStatus | null
  identity: ModelProviderIdentity
  models: ProviderModelInfo[]
  serviceStatus: ProviderServiceStatus | null
  t: TranslationFn
}) => {
  const modelIds = normalizeProviderModels(models)
  if (accountStatus == null && serviceStatus == null && modelIds.length === 0 && !identity.warnings?.length) {
    return null
  }

  return (
    <div className='config-view__model-service-action-results'>
      {accountStatus != null && (
        <div className='config-view__model-service-result'>
          <span>{t('config.modelServices.results.balance')}</span>
          <strong>{formatBalance(accountStatus, t)}</strong>
        </div>
      )}
      {serviceStatus != null && (
        <div className='config-view__model-service-result'>
          <span>{t('config.modelServices.results.status')}</span>
          <strong>{formatStatus(serviceStatus, t)}</strong>
        </div>
      )}
      {modelIds.length > 0 && (
        <div className='config-view__model-service-models'>
          <span>{t('config.modelServices.results.models', { count: modelIds.length })}</span>
          <div className='config-view__model-service-model-list'>
            {modelIds.slice(0, 12).map(modelId => <code key={modelId}>{modelId}</code>)}
            {modelIds.length > 12 && (
              <span>{t('config.modelServices.results.modelsMore', { count: modelIds.length - 12 })}</span>
            )}
          </div>
        </div>
      )}
      {identity.warnings?.map(warning => (
        <div key={warning} className='config-view__model-service-warning'>{warning}</div>
      ))}
    </div>
  )
}
