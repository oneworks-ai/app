import { Alert, Button } from 'antd'
import { useTranslation } from 'react-i18next'

import type { LauncherWorkspaceVersionConflictDetails } from '@oneworks/types'

const formatIdentityValue = (value?: string) => {
  if (value == null || value.trim() === '') return 'n/a'
  if (value.startsWith('git:') || value.startsWith('git-runtime:')) {
    return value.length > 38 ? `${value.slice(0, 38)}...` : value
  }
  return value
}

export function WorkspaceConnectionErrorView({
  details,
  isRestarting,
  message,
  restartErrorMessage,
  onRestart,
  onRetry
}: {
  details?: LauncherWorkspaceVersionConflictDetails
  isRestarting: boolean
  message: string
  restartErrorMessage?: string
  onRestart: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className='workspace-connection-gate workspace-connection-gate--error'>
      <Alert
        type='error'
        showIcon
        message={message}
        description={details == null
          ? undefined
          : (
            <div className='workspace-connection-gate__details'>
              <div className='workspace-connection-gate__summary'>
                {t('workspaceConnection.versionConflictDescription')}
              </div>
              <dl className='workspace-connection-gate__meta'>
                <div>
                  <dt>{t('workspaceConnection.runningVersion')}</dt>
                  <dd>{formatIdentityValue(details.existing.sourceVersionId ?? details.existing.implementationId)}</dd>
                </div>
                <div>
                  <dt>{t('workspaceConnection.requestedVersion')}</dt>
                  <dd>
                    {formatIdentityValue(details.requested.sourceVersionId ?? details.requested.implementationId)}
                  </dd>
                </div>
                <div>
                  <dt>{t('workspaceConnection.serverUrl')}</dt>
                  <dd>{details.existing.serverBaseUrl ?? 'n/a'}</dd>
                </div>
                <div>
                  <dt>{t('workspaceConnection.processId')}</dt>
                  <dd>{details.existing.pid ?? 'n/a'}</dd>
                </div>
              </dl>
              <div className='workspace-connection-gate__actions'>
                {details.restartable && (
                  <Button
                    type='primary'
                    loading={isRestarting}
                    onClick={onRestart}
                  >
                    {t('workspaceConnection.restartWorkspaceServer')}
                  </Button>
                )}
                <Button onClick={onRetry} disabled={isRestarting}>
                  {t('workspaceConnection.retry')}
                </Button>
              </div>
              {restartErrorMessage != null && (
                <div className='workspace-connection-gate__restart-error'>
                  {restartErrorMessage}
                </div>
              )}
            </div>
          )}
      />
    </div>
  )
}
